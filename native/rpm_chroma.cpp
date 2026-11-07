// The fingerprint of a file, as the desktop app's fpcalc makes it.
//
// The rpm database matches on these numbers, so they must be the ones the desktop sends. This is
// ProcessFile in src/cmd/fpcalc.cpp of Chromaprint 1.6.0 with -length 0, over the same FFmpegAudioReader.
// fpcalc is run twice for the two forms of the answer. Here one pass gives both. Compare it again when the
// Chromaprint version changes. test/parity checks the result.

#include <cstdlib>
#include <cstring>

#include <chromaprint.h>

#include "audio/ffmpeg_audio_reader.h"
#include "rpm_media.h"

struct RmFingerprint {
    char *text;
    uint32_t *raw;
    int frames;
    double seconds;
};

RmFingerprint *rm_fingerprint(const char *path)
{
    using namespace chromaprint;

    ChromaprintContext *context = chromaprint_new(CHROMAPRINT_ALGORITHM_DEFAULT);
    if (!context) return nullptr;
    SCOPE_EXIT(chromaprint_free(context));

    FFmpegAudioReader reader;
    reader.SetOutputChannels(chromaprint_get_num_channels(context));
    reader.SetOutputSampleRate(chromaprint_get_sample_rate(context));
    if (!reader.Open(path)) {
        rpm_set_error(reader.GetError().c_str());
        return nullptr;
    }

    if (!chromaprint_start(context, reader.GetSampleRate(), reader.GetChannels())) {
        rpm_set_error("Could not start the fingerprint.");
        return nullptr;
    }

    // A failed read keeps what came before it. Many FLAC files end in an ID3v1 tag, which FFmpeg reads
    // as a broken frame after the whole song has been decoded, and that is a good fingerprint.
    size_t samples = 0;
    while (!reader.IsFinished()) {
        const int16_t *data = nullptr;
        size_t size = 0;
        if (!reader.Read(&data, &size)) {
            rpm_set_error(reader.GetError().c_str());
            break;
        }
        if (size == 0) continue;
        samples += size;
        if (!chromaprint_feed(context, data, size * reader.GetChannels())) {
            rpm_set_error("Could not read the audio into the fingerprint.");
            return nullptr;
        }
    }

    if (!chromaprint_finish(context)) {
        rpm_set_error("Could not finish the fingerprint.");
        return nullptr;
    }

    char *text = nullptr;
    uint32_t *raw = nullptr;
    int frames = 0;
    if (!chromaprint_get_fingerprint(context, &text) || !chromaprint_get_raw_fingerprint(context, &raw, &frames) || frames == 0) {
        chromaprint_dealloc(text);
        chromaprint_dealloc(raw);
        rpm_set_error("Not enough audio for a fingerprint.");
        return nullptr;
    }

    // fpcalc asks the file. A file that does not say is measured by what was read, because the server
    // refuses a length of zero.
    const int milliseconds = reader.GetDuration();
    const double read = double(samples) / reader.GetSampleRate();
    return new RmFingerprint{text, raw, frames, milliseconds > 0 ? milliseconds / 1000.0 : read};
}

const char *rm_fingerprint_text(const RmFingerprint *fingerprint) { return fingerprint->text; }

const int32_t *rm_fingerprint_raw(const RmFingerprint *fingerprint)
{
    return reinterpret_cast<const int32_t *>(fingerprint->raw);
}

int rm_fingerprint_frames(const RmFingerprint *fingerprint) { return fingerprint->frames; }

double rm_fingerprint_seconds(const RmFingerprint *fingerprint) { return fingerprint->seconds; }

void rm_fingerprint_close(RmFingerprint *fingerprint)
{
    chromaprint_dealloc(fingerprint->text);
    chromaprint_dealloc(fingerprint->raw);
    delete fingerprint;
}
