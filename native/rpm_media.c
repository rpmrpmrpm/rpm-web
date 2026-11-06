// The media functions of rpm for the browser, on FFmpeg's libraries.
//
// The canonical copy must give the same bytes as this command, which the desktop app runs:
//
//   ffmpeg -i <in> -map 0:a -c copy -map_metadata -1 -map_chapters -1 -bitexact [-movflags +faststart]
//          [-f mp4] <out>
//
// The hash of those bytes is the key of the blob in the store, so a difference of one byte stores the
// same track twice. FFmpeg's command-line tool needs threads, and this build has none, so the steps of
// the tool are repeated here. Each function below names the function of the tool it follows, in
// fftools/ffmpeg_demux.c, fftools/ffmpeg_mux.c and fftools/ffmpeg_mux_init.c of FFmpeg 8.1.3. Compare
// them again when the FFmpeg version changes. test/parity checks the result.

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include <emscripten.h>

#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/audio_fifo.h>
#include <libavutil/avutil.h>
#include <libavutil/channel_layout.h>
#include <libavutil/mathematics.h>
#include <libavutil/mem.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>

#include "rpm_media.h"

// Defaults of the command-line tool.
#define DTS_DELTA_THRESHOLD 10
#define DTS_ERROR_THRESHOLD (3600 * 30)
#define MUX_MAX_DELAY 700000

static char last_error[4096];

static void clear_error(void) { last_error[0] = 0; }

static void add_error(const char *text)
{
    size_t used = strlen(last_error);
    snprintf(last_error + used, sizeof(last_error) - used, "%s", text);
}

// Keeps what FFmpeg says at error level. The caller needs the words: a refused codec is told apart from
// an unreadable file by them, as CanonicalAudio does on the desktop.
static void log_to_last_error(void *object, int level, const char *format, va_list args)
{
    (void)object;
    if (level > AV_LOG_ERROR) return;
    size_t used = strlen(last_error);
    vsnprintf(last_error + used, sizeof(last_error) - used, format, args);
}

const char *rpm_last_error(void) { return last_error; }

// The state the tool keeps per stream, on the input side and the output side.
typedef struct CopyStream {
    AVStream *in;
    AVStream *out;

    int saw_first_ts;
    int wrap_correction_done;
    int64_t first_dts;
    int64_t dts;
    int64_t next_dts;

    int started;
    int64_t rescale_delta_last;
    int64_t last_mux_dts;
} CopyStream;

// The state the tool keeps per input file.
typedef struct CopyInput {
    int discontinuous;
    int64_t ts_offset;
    int64_t ts_offset_discont;
    int64_t last_ts;
    int64_t start_time;
} CopyInput;

// ts_discontinuity_detect, without the parts for -copyts.
static void detect_discontinuity(CopyInput *input, CopyStream *s, AVPacket *pkt)
{
    int64_t pkt_dts = av_rescale_q_rnd(pkt->dts, pkt->time_base, AV_TIME_BASE_Q,
                                       AV_ROUND_NEAR_INF | AV_ROUND_PASS_MINMAX);

    if (s->next_dts != AV_NOPTS_VALUE) {
        int64_t delta = pkt_dts - s->next_dts;
        if (input->discontinuous) {
            if (FFABS(delta) > 1LL * DTS_DELTA_THRESHOLD * AV_TIME_BASE ||
                pkt_dts + AV_TIME_BASE / 10 < s->dts) {
                input->ts_offset_discont -= delta;
                pkt->dts -= av_rescale_q(delta, AV_TIME_BASE_Q, pkt->time_base);
                if (pkt->pts != AV_NOPTS_VALUE)
                    pkt->pts -= av_rescale_q(delta, AV_TIME_BASE_Q, pkt->time_base);
            }
        } else {
            if (FFABS(delta) > 1LL * DTS_ERROR_THRESHOLD * AV_TIME_BASE)
                pkt->dts = AV_NOPTS_VALUE;
            if (pkt->pts != AV_NOPTS_VALUE) {
                int64_t pkt_pts = av_rescale_q(pkt->pts, pkt->time_base, AV_TIME_BASE_Q);
                delta = pkt_pts - s->next_dts;
                if (FFABS(delta) > 1LL * DTS_ERROR_THRESHOLD * AV_TIME_BASE)
                    pkt->pts = AV_NOPTS_VALUE;
            }
        }
    } else if (input->discontinuous && input->last_ts != AV_NOPTS_VALUE) {
        int64_t delta = pkt_dts - input->last_ts;
        if (FFABS(delta) > 1LL * DTS_DELTA_THRESHOLD * AV_TIME_BASE) {
            input->ts_offset_discont -= delta;
            pkt->dts -= av_rescale_q(delta, AV_TIME_BASE_Q, pkt->time_base);
            if (pkt->pts != AV_NOPTS_VALUE)
                pkt->pts -= av_rescale_q(delta, AV_TIME_BASE_Q, pkt->time_base);
        }
    }

    input->last_ts = av_rescale_q(pkt->dts, pkt->time_base, AV_TIME_BASE_Q);
}

// ist_dts_update, for audio. Returns the estimated dts of the packet.
static int64_t update_dts(CopyStream *s, const AVPacket *pkt)
{
    if (!s->saw_first_ts) {
        s->first_dts = s->dts = 0;
        if (pkt->pts != AV_NOPTS_VALUE) {
            s->first_dts = s->dts += av_rescale_q(pkt->pts, pkt->time_base, AV_TIME_BASE_Q);
        }
        s->saw_first_ts = 1;
    }

    if (s->next_dts == AV_NOPTS_VALUE) s->next_dts = s->dts;

    if (pkt->dts != AV_NOPTS_VALUE)
        s->next_dts = s->dts = av_rescale_q(pkt->dts, pkt->time_base, AV_TIME_BASE_Q);

    s->dts = s->next_dts;

    const AVCodecParameters *par = s->in->codecpar;
    if (par->sample_rate)
        s->next_dts += ((int64_t)AV_TIME_BASE * par->frame_size) / par->sample_rate;
    else
        s->next_dts += av_rescale_q(pkt->duration, pkt->time_base, AV_TIME_BASE_Q);

    return s->dts;
}

// ts_fixup and ts_discontinuity_process. Returns the estimated dts of the packet.
static int64_t fix_input_timestamps(CopyInput *input, CopyStream *s, AVPacket *pkt)
{
    pkt->time_base = s->in->time_base;

    if (!s->wrap_correction_done && input->start_time != AV_NOPTS_VALUE &&
        s->in->pts_wrap_bits < 64) {
        int64_t stime = av_rescale_q(input->start_time, AV_TIME_BASE_Q, pkt->time_base);
        int64_t stime2 = stime + (1ULL << s->in->pts_wrap_bits);
        int64_t half = 1LL << (s->in->pts_wrap_bits - 1);
        s->wrap_correction_done = 1;

        if (stime2 > stime && pkt->dts != AV_NOPTS_VALUE && pkt->dts > stime + half) {
            pkt->dts -= 1ULL << s->in->pts_wrap_bits;
            s->wrap_correction_done = 0;
        }
        if (stime2 > stime && pkt->pts != AV_NOPTS_VALUE && pkt->pts > stime + half) {
            pkt->pts -= 1ULL << s->in->pts_wrap_bits;
            s->wrap_correction_done = 0;
        }
    }

    if (pkt->dts != AV_NOPTS_VALUE)
        pkt->dts += av_rescale_q(input->ts_offset, AV_TIME_BASE_Q, pkt->time_base);
    if (pkt->pts != AV_NOPTS_VALUE)
        pkt->pts += av_rescale_q(input->ts_offset, AV_TIME_BASE_Q, pkt->time_base);

    int64_t offset = av_rescale_q(input->ts_offset_discont, AV_TIME_BASE_Q, pkt->time_base);
    if (pkt->dts != AV_NOPTS_VALUE) pkt->dts += offset;
    if (pkt->pts != AV_NOPTS_VALUE) pkt->pts += offset;

    if (pkt->dts != AV_NOPTS_VALUE) detect_discontinuity(input, s, pkt);

    return update_dts(s, pkt);
}

// of_streamcopy, with no -ss and no -t. Returns 0 when the packet is dropped.
static int start_or_continue_copy(CopyStream *s, AVPacket *pkt, int64_t dts_estimate)
{
    if (!s->started && !(pkt->flags & AV_PKT_FLAG_KEY)) return 0;

    if (pkt->dts == AV_NOPTS_VALUE)
        pkt->dts = av_rescale_q(dts_estimate, AV_TIME_BASE_Q, pkt->time_base);
    else
        pkt->pts = pkt->dts;

    s->started = 1;
    return 1;
}

// mux_fixup_ts, for a stream-copied audio stream.
static void fix_output_timestamps(const AVFormatContext *out, CopyStream *s, AVPacket *pkt)
{
    int duration = av_get_audio_frame_duration2(s->out->codecpar, pkt->size);
    if (!duration) duration = s->out->codecpar->frame_size;

    pkt->dts = av_rescale_delta(pkt->time_base, pkt->dts,
                                (AVRational){1, s->out->codecpar->sample_rate}, duration,
                                &s->rescale_delta_last, s->out->time_base);
    pkt->pts = pkt->dts;
    pkt->duration = av_rescale_q(pkt->duration, pkt->time_base, s->out->time_base);
    pkt->time_base = s->out->time_base;

    if (!(out->oformat->flags & AVFMT_NOTIMESTAMPS)) {
        if (pkt->dts != AV_NOPTS_VALUE && s->last_mux_dts != AV_NOPTS_VALUE) {
            int64_t max = s->last_mux_dts + !(out->oformat->flags & AVFMT_TS_NONSTRICT);
            if (pkt->dts < max) {
                if (pkt->pts >= pkt->dts) pkt->pts = FFMAX(pkt->pts, max);
                pkt->dts = max;
            }
        }
    }
    s->last_mux_dts = pkt->dts;
}

// streamcopy_init and the parts of ost_add and of_stream_init that a stream copy reaches.
static int add_output_stream(AVFormatContext *out, CopyStream *s)
{
    int ret;
    AVStream *in = s->in;
    AVStream *st = avformat_new_stream(out, NULL);
    if (!st) return AVERROR(ENOMEM);
    s->out = st;

    AVCodecParameters *par = avcodec_parameters_alloc();
    AVCodecContext *context = avcodec_alloc_context3(NULL);
    if (!par || !context) {
        ret = AVERROR(ENOMEM);
        goto done;
    }

    uint32_t codec_tag = in->codecpar->codec_tag;

    ret = avcodec_parameters_to_context(context, in->codecpar);
    if (ret >= 0) ret = avcodec_parameters_from_context(par, context);
    if (ret < 0) goto done;

    if (!codec_tag) {
        const struct AVCodecTag *const *tags = out->oformat->codec_tag;
        unsigned int unused;
        if (!tags || av_codec_get_id(tags, par->codec_tag) == par->codec_id ||
            !av_codec_get_tag2(tags, par->codec_id, &unused))
            codec_tag = par->codec_tag;
    }
    par->codec_tag = codec_tag;

    st->avg_frame_rate = in->avg_frame_rate;
    st->time_base = av_add_q(in->time_base, (AVRational){0, 1});

    for (int i = 0; i < in->codecpar->nb_coded_side_data; i++) {
        const AVPacketSideData *from = &in->codecpar->coded_side_data[i];
        AVPacketSideData *to = av_packet_side_data_new(&st->codecpar->coded_side_data,
                                                       &st->codecpar->nb_coded_side_data,
                                                       from->type, from->size, 0);
        if (!to) {
            ret = AVERROR(ENOMEM);
            goto done;
        }
        memcpy(to->data, from->data, from->size);
    }

    if ((par->block_align == 1 || par->block_align == 1152 || par->block_align == 576) &&
        par->codec_id == AV_CODEC_ID_MP3)
        par->block_align = 0;
    if (par->codec_id == AV_CODEC_ID_AC3) par->block_align = 0;

    // The side data was added to the stream above, and this copy must not remove it.
    int side_count = st->codecpar->nb_coded_side_data;
    AVPacketSideData *side = st->codecpar->coded_side_data;
    st->codecpar->nb_coded_side_data = 0;
    st->codecpar->coded_side_data = NULL;

    av_packet_side_data_free(&par->coded_side_data, &par->nb_coded_side_data);
    par->coded_side_data = side;
    par->nb_coded_side_data = side_count;

    ret = avcodec_parameters_copy(st->codecpar, par);

done:
    avcodec_free_context(&context);
    avcodec_parameters_free(&par);
    return ret;
}

// set_dispositions, with no manual disposition.
static void set_dispositions(CopyStream *streams, int count)
{
    int mapped = 0, have_default = 0;

    for (int i = 0; i < count; i++) {
        if (!streams[i].out) continue;
        mapped++;
        streams[i].out->disposition = streams[i].in->disposition;
        if (streams[i].out->disposition & AV_DISPOSITION_DEFAULT) have_default = 1;
    }

    for (int i = 0; i < count; i++) {
        if (!streams[i].out) continue;
        if (mapped < 2 || have_default || streams[i].out->disposition & AV_DISPOSITION_ATTACHED_PIC)
            continue;
        streams[i].out->disposition |= AV_DISPOSITION_DEFAULT;
        have_default = 1;
    }
}

// correct_input_start_times, for containers whose timestamps may jump. It reads the start of the
// streams that are kept, so it runs after the others are discarded.
static void correct_start_time(CopyInput *input, const AVFormatContext *in)
{
    if (in->start_time == AV_NOPTS_VALUE || !input->discontinuous) return;

    int64_t new_start_time = INT64_MAX;
    for (unsigned i = 0; i < in->nb_streams; i++) {
        const AVStream *st = in->streams[i];
        if (st->discard == AVDISCARD_ALL || st->start_time == AV_NOPTS_VALUE) continue;
        new_start_time = FFMIN(new_start_time,
                               av_rescale_q(st->start_time, st->time_base, AV_TIME_BASE_Q));
    }

    if (new_start_time - in->start_time) {
        input->start_time = new_start_time;
        input->ts_offset = in->start_time > new_start_time ? -in->start_time : -new_start_time;
    }
}

static int has_mp4_extension(const char *path)
{
    const char *dot = strrchr(path, '.');
    return dot && (!strcmp(dot, ".m4a") || !strcmp(dot, ".mp4") || !strcmp(dot, ".m4b"));
}

int rpm_canonical(const char *in_path, const char *out_path, int force_mp4)
{
    AVFormatContext *in = NULL, *out = NULL;
    CopyStream *streams = NULL;
    AVDictionary *options = NULL;
    AVPacket *pkt = NULL;
    int ret, mapped = 0, header_written = 0;

    clear_error();
    av_log_set_callback(log_to_last_error);

    ret = avformat_open_input(&in, in_path, NULL, NULL);
    if (ret < 0) goto done;
    ret = avformat_find_stream_info(in, NULL);
    if (ret < 0) goto done;

    CopyInput input = {
        .discontinuous = !!(in->iformat->flags & AVFMT_TS_DISCONT),
        .ts_offset = in->start_time != AV_NOPTS_VALUE ? -in->start_time : 0,
        .ts_offset_discont = 0,
        .last_ts = AV_NOPTS_VALUE,
        .start_time = in->start_time,
    };

    ret = avformat_alloc_output_context2(&out, NULL, force_mp4 ? "mp4" : NULL, out_path);
    if (ret < 0) goto done;
    out->flags |= AVFMT_FLAG_BITEXACT;
    out->max_delay = MUX_MAX_DELAY;

    streams = av_calloc(in->nb_streams, sizeof(*streams));
    if (!streams) {
        ret = AVERROR(ENOMEM);
        goto done;
    }

    // Audio only. Cover art is a video stream in most containers, and it stays out.
    for (unsigned i = 0; i < in->nb_streams; i++) {
        CopyStream *s = &streams[i];
        s->in = in->streams[i];
        s->first_dts = AV_NOPTS_VALUE;
        s->next_dts = AV_NOPTS_VALUE;
        s->last_mux_dts = AV_NOPTS_VALUE;

        if (s->in->codecpar->codec_type != AVMEDIA_TYPE_AUDIO) {
            s->in->discard = AVDISCARD_ALL;
            continue;
        }
        ret = add_output_stream(out, s);
        if (ret < 0) goto done;
        mapped++;
    }
    if (!mapped) {
        add_error("Output file does not contain any stream");
        ret = AVERROR(EINVAL);
        goto done;
    }
    set_dispositions(streams, in->nb_streams);
    correct_start_time(&input, in);

    if (!(out->oformat->flags & AVFMT_NOFILE)) {
        ret = avio_open2(&out->pb, out_path, AVIO_FLAG_WRITE, NULL, NULL);
        if (ret < 0) goto done;
    }

    if (has_mp4_extension(out_path)) av_dict_set(&options, "movflags", "+faststart", 0);

    ret = avformat_write_header(out, &options);
    if (ret < 0) {
        add_error("Could not write header");
        goto done;
    }
    header_written = 1;

    pkt = av_packet_alloc();
    if (!pkt) {
        ret = AVERROR(ENOMEM);
        goto done;
    }

    for (;;) {
        ret = av_read_frame(in, pkt);
        if (ret == AVERROR(EAGAIN)) continue;

        // The tool treats a read error as the end of the file and keeps what it has. Doing the same
        // gives the same bytes for a damaged file. A file that cannot be read at all failed above.
        if (ret < 0) break;

        CopyStream *s = &streams[pkt->stream_index];
        if (!s->out) {
            av_packet_unref(pkt);
            continue;
        }

        int64_t dts_estimate = fix_input_timestamps(&input, s, pkt);

        if (!start_or_continue_copy(s, pkt, dts_estimate)) {
            av_packet_unref(pkt);
            continue;
        }

        fix_output_timestamps(out, s, pkt);
        pkt->stream_index = s->out->index;

        ret = av_interleaved_write_frame(out, pkt);
        if (ret < 0) goto done;
    }

    ret = av_write_trailer(out);
    header_written = 0;

done:
    if (ret < 0 && !last_error[0]) add_error(av_err2str(ret));
    if (header_written) av_write_trailer(out);
    av_packet_free(&pkt);
    av_dict_free(&options);
    if (out && !(out->oformat->flags & AVFMT_NOFILE)) avio_closep(&out->pb);
    avformat_free_context(out);
    av_freep(&streams);
    avformat_close_input(&in);
    return ret < 0 ? ret : 0;
}

// --- Reading a track ---------------------------------------------------------------------------

EM_JS(int, source_read, (int source, unsigned char *buffer, int size), {
    return Module.rmSources.read(source, HEAPU8.subarray(buffer, buffer + size));
});

EM_JS(double, source_seek, (int source, double offset, int whence), {
    return Module.rmSources.seek(source, offset, whence);
});

// AVSEEK_SIZE asks for the length of the source, and the JavaScript side reads whence 3 as that.
#define SOURCE_SIZE 3

#define IO_BUFFER 65536

struct RmDecoder {
    int source;
    int sample_rate;
    AVFormatContext *format;
    AVIOContext *io;
    AVCodecContext *codec;
    SwrContext *swr;
    AVPacket *pkt;
    AVFrame *frame;
    int stream;
    int input_ended;
    int decoder_ended;
    int flushed;
    double seek_target;
    int64_t drop_frames;
};

static int read_source(void *opaque, uint8_t *buffer, int size)
{
    int got = source_read((int)(intptr_t)opaque, buffer, size);
    if (got == 0) return AVERROR_EOF;
    return got < 0 ? AVERROR(EIO) : got;
}

static int64_t seek_source(void *opaque, int64_t offset, int whence)
{
    int source = (int)(intptr_t)opaque;
    if (whence & AVSEEK_SIZE) return (int64_t)source_seek(source, 0, SOURCE_SIZE);
    return (int64_t)source_seek(source, (double)offset, whence & ~AVSEEK_FORCE);
}

void rm_close(RmDecoder *d)
{
    if (!d) return;
    swr_free(&d->swr);
    avcodec_free_context(&d->codec);
    avformat_close_input(&d->format);
    if (d->io) {
        av_freep(&d->io->buffer);
        avio_context_free(&d->io);
    }
    av_packet_free(&d->pkt);
    av_frame_free(&d->frame);
    av_free(d);
}

RmDecoder *rm_open(int source, const char *name, int sample_rate)
{
    clear_error();
    av_log_set_callback(log_to_last_error);

    RmDecoder *d = av_mallocz(sizeof(*d));
    if (!d) return NULL;
    d->source = source;
    d->sample_rate = sample_rate;
    d->seek_target = -1;

    unsigned char *buffer = av_malloc(IO_BUFFER);
    d->pkt = av_packet_alloc();
    d->frame = av_frame_alloc();
    d->format = avformat_alloc_context();
    if (!buffer || !d->pkt || !d->frame || !d->format) goto fail;

    d->io = avio_alloc_context(buffer, IO_BUFFER, 0, (void *)(intptr_t)source, read_source, NULL, seek_source);
    if (!d->io) goto fail;
    d->format->pb = d->io;
    d->format->flags |= AVFMT_FLAG_CUSTOM_IO;

    if (avformat_open_input(&d->format, name, NULL, NULL) < 0) goto fail;
    if (avformat_find_stream_info(d->format, NULL) < 0) goto fail;

    const AVCodec *codec = NULL;
    d->stream = av_find_best_stream(d->format, AVMEDIA_TYPE_AUDIO, -1, -1, &codec, 0);
    if (d->stream < 0) goto fail;

    for (unsigned i = 0; i < d->format->nb_streams; i++)
        if ((int)i != d->stream) d->format->streams[i]->discard = AVDISCARD_ALL;

    d->codec = avcodec_alloc_context3(codec);
    if (!d->codec) goto fail;
    if (avcodec_parameters_to_context(d->codec, d->format->streams[d->stream]->codecpar) < 0) goto fail;
    d->codec->pkt_timebase = d->format->streams[d->stream]->time_base;
    if (avcodec_open2(d->codec, codec, NULL) < 0) goto fail;

    return d;

fail:
    if (!last_error[0]) add_error("The file could not be opened");
    rm_close(d);
    return NULL;
}

double rm_duration(const RmDecoder *d)
{
    return d->format->duration == AV_NOPTS_VALUE ? 0 : d->format->duration / (double)AV_TIME_BASE;
}

int rm_seek(RmDecoder *d, double seconds)
{
    int64_t target = (int64_t)(seconds * AV_TIME_BASE);
    int ret = avformat_seek_file(d->format, -1, INT64_MIN, target, target, 0);
    if (ret < 0) return ret;

    avcodec_flush_buffers(d->codec);
    swr_free(&d->swr);
    d->input_ended = d->decoder_ended = d->flushed = 0;
    d->seek_target = seconds;
    d->drop_frames = 0;
    return 0;
}

// Sets up the converter on the first frame, because the file may not state its layout until then.
static int open_converter(RmDecoder *d, const AVFrame *frame)
{
    AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
    int ret = swr_alloc_set_opts2(&d->swr, &stereo, AV_SAMPLE_FMT_FLT, d->sample_rate,
                                  &frame->ch_layout, frame->format, frame->sample_rate, 0, NULL);
    return ret < 0 ? ret : swr_init(d->swr);
}

// After a seek, the first frame starts before the target. The samples before it are dropped, so the
// position is exact and not the nearest frame.
static void plan_drop_after_seek(RmDecoder *d, const AVFrame *frame)
{
    if (d->seek_target < 0) return;
    const AVRational base = d->format->streams[d->stream]->time_base;
    double at = frame->pts == AV_NOPTS_VALUE ? d->seek_target : frame->pts * av_q2d(base);
    double early = d->seek_target - at;
    d->drop_frames = early > 0 ? (int64_t)(early * d->sample_rate + 0.5) : 0;
    d->seek_target = -1;
}

// The samples of a frame that belong to the track. An AAC encoder fills its last block with padding.
// The MP4 file says where the music ends, in the duration of the last packet, but the decoder still
// returns the whole block. Without this, each join in an AAC album has up to 23 ms of silence in it.
static int exact_samples(const RmDecoder *d, const AVFrame *frame)
{
    if (frame->duration <= 0) return frame->nb_samples;

    const AVRational base = d->format->streams[d->stream]->time_base;
    int64_t samples = av_rescale_q(frame->duration, base, (AVRational){1, frame->sample_rate});
    return samples > 0 && samples < frame->nb_samples ? (int)samples : frame->nb_samples;
}

// Decodes one frame into the converter. Returns 0, or AVERROR_EOF when nothing is left to decode.
static int decode_one(RmDecoder *d)
{
    for (;;) {
        int ret = avcodec_receive_frame(d->codec, d->frame);
        if (ret == 0) {
            plan_drop_after_seek(d, d->frame);
            if (!d->swr && (ret = open_converter(d, d->frame)) < 0) return ret;
            ret = swr_convert(d->swr, NULL, 0, (const uint8_t **)d->frame->extended_data,
                              exact_samples(d, d->frame));
            av_frame_unref(d->frame);
            return ret < 0 ? ret : 0;
        }
        if (ret == AVERROR_EOF) return ret;
        if (ret != AVERROR(EAGAIN)) return ret;

        if (d->input_ended) continue;

        ret = av_read_frame(d->format, d->pkt);
        if (ret < 0) {
            d->input_ended = 1;
            avcodec_send_packet(d->codec, NULL);
            continue;
        }
        if (d->pkt->stream_index == d->stream) {
            // A damaged packet is skipped. The next one may be good.
            avcodec_send_packet(d->codec, d->pkt);
        }
        av_packet_unref(d->pkt);
    }
}

int rm_read_pcm(RmDecoder *d, float *samples, int frames)
{
    int got = 0;

    while (got < frames) {
        if (d->swr) {
            uint8_t *out = (uint8_t *)(samples + got * 2);
            int made = swr_convert(d->swr, &out, frames - got, NULL, 0);
            if (made < 0) return made;

            if (made > 0) {
                int64_t dropped = FFMIN(d->drop_frames, made);
                d->drop_frames -= dropped;
                if (dropped < made && dropped > 0)
                    memmove(samples + got * 2, samples + (got + dropped) * 2,
                            (made - dropped) * 2 * sizeof(float));
                got += made - dropped;
                continue;
            }
        }

        if (d->flushed) break;

        int ret = decode_one(d);
        if (ret == AVERROR_EOF) {
            d->flushed = 1;
            if (!d->swr) break;
            continue;
        }
        if (ret < 0) return got > 0 ? got : ret;
    }

    return got;
}

// --- The output stream -------------------------------------------------------------------------

#define STREAM_CHANNELS 2

struct RmOutput {
    AVFormatContext *mux;
    AVCodecContext *encoder;
    AVIOContext *io;
    AVAudioFifo *fifo;
    AVFrame *frame;
    AVPacket *pkt;
    int64_t next_pts;
    unsigned char *data;
    int size;
    int capacity;
};

static int keep_bytes(void *opaque, const uint8_t *buffer, int size)
{
    RmOutput *o = opaque;
    if (o->size + size > o->capacity) {
        int capacity = FFMAX(o->capacity * 2, o->size + size);
        unsigned char *grown = av_realloc(o->data, capacity);
        if (!grown) return AVERROR(ENOMEM);
        o->data = grown;
        o->capacity = capacity;
    }
    memcpy(o->data + o->size, buffer, size);
    o->size += size;
    return size;
}

void rm_output_close(RmOutput *o)
{
    if (!o) return;
    if (o->mux) avformat_free_context(o->mux);
    if (o->io) {
        av_freep(&o->io->buffer);
        avio_context_free(&o->io);
    }
    avcodec_free_context(&o->encoder);
    if (o->fifo) av_audio_fifo_free(o->fifo);
    av_frame_free(&o->frame);
    av_packet_free(&o->pkt);
    av_freep(&o->data);
    av_free(o);
}

RmOutput *rm_output_open(int sample_rate)
{
    clear_error();
    av_log_set_callback(log_to_last_error);

    RmOutput *o = av_mallocz(sizeof(*o));
    if (!o) return NULL;

    const AVCodec *flac = avcodec_find_encoder(AV_CODEC_ID_FLAC);
    unsigned char *buffer = av_malloc(IO_BUFFER);
    o->encoder = avcodec_alloc_context3(flac);
    o->frame = av_frame_alloc();
    o->pkt = av_packet_alloc();
    if (!flac || !buffer || !o->encoder || !o->frame || !o->pkt) goto fail;

    AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
    o->encoder->sample_fmt = AV_SAMPLE_FMT_S16;
    o->encoder->sample_rate = sample_rate;
    o->encoder->time_base = (AVRational){1, sample_rate};
    o->encoder->compression_level = 0;
    o->encoder->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    if (av_channel_layout_copy(&o->encoder->ch_layout, &stereo) < 0) goto fail;
    if (avcodec_open2(o->encoder, flac, NULL) < 0) goto fail;

    o->fifo = av_audio_fifo_alloc(AV_SAMPLE_FMT_S16, STREAM_CHANNELS, o->encoder->frame_size * 2);
    if (!o->fifo) goto fail;

    if (avformat_alloc_output_context2(&o->mux, NULL, "mp4", NULL) < 0) goto fail;
    o->io = avio_alloc_context(buffer, IO_BUFFER, 1, o, NULL, keep_bytes, NULL);
    if (!o->io) goto fail;
    o->mux->pb = o->io;
    o->mux->flags |= AVFMT_FLAG_CUSTOM_IO;
    o->mux->strict_std_compliance = FF_COMPLIANCE_EXPERIMENTAL;

    AVStream *st = avformat_new_stream(o->mux, NULL);
    if (!st || avcodec_parameters_from_context(st->codecpar, o->encoder) < 0) goto fail;
    st->time_base = o->encoder->time_base;

    AVDictionary *options = NULL;
    av_dict_set(&options, "movflags", "empty_moov+default_base_moof+frag_custom", 0);
    int ret = avformat_write_header(o->mux, &options);
    av_dict_free(&options);
    if (ret < 0) goto fail;
    avio_flush(o->io);

    return o;

fail:
    if (!last_error[0]) add_error("The output stream could not be opened");
    rm_output_close(o);
    return NULL;
}

static int encode_frames(RmOutput *o, int flush)
{
    int block = o->encoder->frame_size;

    while (av_audio_fifo_size(o->fifo) >= block || (flush && av_audio_fifo_size(o->fifo) > 0)) {
        AVFrame *frame = o->frame;
        av_frame_unref(frame);
        frame->nb_samples = FFMIN(block, av_audio_fifo_size(o->fifo));
        frame->format = AV_SAMPLE_FMT_S16;
        frame->sample_rate = o->encoder->sample_rate;
        int ret = av_channel_layout_copy(&frame->ch_layout, &o->encoder->ch_layout);
        if (ret >= 0) ret = av_frame_get_buffer(frame, 0);
        if (ret < 0) return ret;

        av_audio_fifo_read(o->fifo, (void **)frame->data, frame->nb_samples);
        frame->pts = o->next_pts;
        o->next_pts += frame->nb_samples;

        ret = avcodec_send_frame(o->encoder, frame);
        if (ret < 0) return ret;

        while ((ret = avcodec_receive_packet(o->encoder, o->pkt)) == 0) {
            av_packet_rescale_ts(o->pkt, o->encoder->time_base, o->mux->streams[0]->time_base);
            o->pkt->stream_index = 0;
            ret = av_write_frame(o->mux, o->pkt);
            av_packet_unref(o->pkt);
            if (ret < 0) return ret;
        }
        if (ret != AVERROR(EAGAIN)) return ret;
    }
    return 0;
}

int rm_output_write(RmOutput *o, const float *samples, int frames)
{
    int16_t *converted = av_malloc_array(frames * STREAM_CHANNELS, sizeof(*converted));
    if (!converted) return AVERROR(ENOMEM);

    for (int i = 0; i < frames * STREAM_CHANNELS; i++) {
        float value = samples[i] * 32768.0f;
        converted[i] = value >= 32767.0f ? 32767 : value <= -32768.0f ? -32768 : (int16_t)lrintf(value);
    }

    void *planes[1] = {converted};
    int ret = av_audio_fifo_write(o->fifo, planes, frames);
    av_free(converted);
    if (ret < 0) return ret;

    return encode_frames(o, 0);
}

int rm_output_cut(RmOutput *o, int flush)
{
    int ret = encode_frames(o, flush);
    if (ret < 0) return ret;

    // With frag_custom, a null packet ends the fragment.
    ret = av_write_frame(o->mux, NULL);
    if (ret < 0) return ret;

    avio_flush(o->io);
    return 0;
}

// The clock moves past what is dropped, so the stream's time stays the frames given to it.
void rm_output_drop(RmOutput *o)
{
    o->next_pts += av_audio_fifo_size(o->fifo);
    av_audio_fifo_reset(o->fifo);
}

const unsigned char *rm_output_data(const RmOutput *o) { return o->data; }

int rm_output_size(const RmOutput *o) { return o->size; }

void rm_output_clear(RmOutput *o) { o->size = 0; }

// --- Renditions --------------------------------------------------------------------------------

#define RENDITION_RATE 44100

// Encodes one frame from the fifo, or flushes the encoder when frame is NULL, and writes the packets.
static int encode_rendition_frame(AVCodecContext *encoder, AVFormatContext *mux, AVStream *st, AVFrame *frame, AVPacket *pkt)
{
    int ret = avcodec_send_frame(encoder, frame);
    if (ret < 0) return ret;

    while ((ret = avcodec_receive_packet(encoder, pkt)) == 0) {
        av_packet_rescale_ts(pkt, encoder->time_base, st->time_base);
        pkt->stream_index = st->index;
        ret = av_interleaved_write_frame(mux, pkt);
        if (ret < 0) return ret;
    }
    return ret == AVERROR(EAGAIN) || ret == AVERROR_EOF ? 0 : ret;
}

// AAC-LC in a faststart MP4 at 44.1 kHz stereo, as Transcoding does on the desktop. seconds of 0 means
// the whole track.
int rm_encode(RmDecoder *d, const char *out_path, int kilobits, double seconds)
{
    AVFormatContext *mux = NULL;
    AVCodecContext *encoder = NULL;
    AVAudioFifo *fifo = NULL;
    AVFrame *frame = av_frame_alloc();
    AVPacket *pkt = av_packet_alloc();
    AVDictionary *options = NULL;
    float *interleaved = NULL;
    int ret = AVERROR(ENOMEM);
    int header_written = 0;

    clear_error();
    av_log_set_callback(log_to_last_error);

    const AVCodec *aac = avcodec_find_encoder(AV_CODEC_ID_AAC);
    if (!frame || !pkt || !aac) goto done;

    encoder = avcodec_alloc_context3(aac);
    if (!encoder) goto done;

    AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
    encoder->sample_fmt = AV_SAMPLE_FMT_FLTP;
    encoder->sample_rate = RENDITION_RATE;
    encoder->bit_rate = kilobits * 1000LL;
    encoder->time_base = (AVRational){1, RENDITION_RATE};
    encoder->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    if ((ret = av_channel_layout_copy(&encoder->ch_layout, &stereo)) < 0) goto done;
    if ((ret = avcodec_open2(encoder, aac, NULL)) < 0) goto done;

    if ((ret = avformat_alloc_output_context2(&mux, NULL, "mp4", out_path)) < 0) goto done;
    mux->flags |= AVFMT_FLAG_BITEXACT;

    AVStream *st = avformat_new_stream(mux, NULL);
    if (!st) {
        ret = AVERROR(ENOMEM);
        goto done;
    }
    if ((ret = avcodec_parameters_from_context(st->codecpar, encoder)) < 0) goto done;
    st->time_base = encoder->time_base;

    if ((ret = avio_open(&mux->pb, out_path, AVIO_FLAG_WRITE)) < 0) goto done;
    av_dict_set(&options, "movflags", "+faststart", 0);
    if ((ret = avformat_write_header(mux, &options)) < 0) goto done;
    header_written = 1;

    int block = encoder->frame_size;
    fifo = av_audio_fifo_alloc(AV_SAMPLE_FMT_FLTP, STREAM_CHANNELS, block * 4);
    interleaved = av_malloc_array(block * STREAM_CHANNELS, sizeof(float));
    if (!fifo || !interleaved) {
        ret = AVERROR(ENOMEM);
        goto done;
    }

    int64_t limit = seconds > 0 ? (int64_t)(seconds * RENDITION_RATE) : INT64_MAX;
    int64_t read_so_far = 0;
    int64_t next_pts = 0;
    int ended = 0;

    while (!ended || av_audio_fifo_size(fifo) > 0) {
        while (!ended && av_audio_fifo_size(fifo) < block) {
            int wanted = (int)FFMIN(block, limit - read_so_far);
            int got = wanted > 0 ? rm_read_pcm(d, interleaved, wanted) : 0;
            if (got < 0) {
                ret = got;
                goto done;
            }
            if (got == 0) {
                ended = 1;
                break;
            }
            read_so_far += got;

            float left[1024 * 4], right[1024 * 4];
            for (int i = 0; i < got; i++) {
                left[i] = interleaved[i * 2];
                right[i] = interleaved[i * 2 + 1];
            }
            void *planes[2] = {left, right};
            if ((ret = av_audio_fifo_write(fifo, planes, got)) < 0) goto done;
        }

        int samples = FFMIN(block, av_audio_fifo_size(fifo));
        if (samples == 0) break;

        av_frame_unref(frame);
        frame->nb_samples = samples;
        frame->format = AV_SAMPLE_FMT_FLTP;
        frame->sample_rate = RENDITION_RATE;
        if ((ret = av_channel_layout_copy(&frame->ch_layout, &stereo)) < 0) goto done;
        if ((ret = av_frame_get_buffer(frame, 0)) < 0) goto done;
        av_audio_fifo_read(fifo, (void **)frame->data, samples);
        frame->pts = next_pts;
        next_pts += samples;

        if ((ret = encode_rendition_frame(encoder, mux, st, frame, pkt)) < 0) goto done;
    }

    if ((ret = encode_rendition_frame(encoder, mux, st, NULL, pkt)) < 0) goto done;
    ret = av_write_trailer(mux);
    header_written = 0;

done:
    if (ret < 0 && !last_error[0]) add_error(av_err2str(ret));
    if (header_written) av_write_trailer(mux);
    if (mux) avio_closep(&mux->pb);
    avformat_free_context(mux);
    avcodec_free_context(&encoder);
    if (fifo) av_audio_fifo_free(fifo);
    av_frame_free(&frame);
    av_packet_free(&pkt);
    av_dict_free(&options);
    av_free(interleaved);
    return ret < 0 ? ret : 0;
}
