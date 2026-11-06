#ifndef RPM_MEDIA_H
#define RPM_MEDIA_H

// Writes the canonical form of in_path to out_path: its audio with every tag removed and nothing
// re-encoded. The muxer is chosen by the extension of out_path, or is the generic mp4 muxer when
// force_mp4 is not zero. Returns 0, or a negative FFmpeg error with the words in rpm_last_error().
int rpm_canonical(const char *in_path, const char *out_path, int force_mp4);

// What FFmpeg said at error level during the last call.
const char *rpm_last_error(void);

// Reading a track. The bytes come from the page through Module.rmSources, which holds the sources by
// number: a File, or a presigned URL read by range.
typedef struct RmDecoder RmDecoder;

// Opens a source. name is its file name, a hint for the format. Returns NULL with the words in
// rpm_last_error().
RmDecoder *rm_open(int source, const char *name, int sample_rate);

// The length of the track in seconds, or 0 when the file does not say.
double rm_duration(const RmDecoder *decoder);

// Moves to a position, in seconds. The next read starts on that sample.
int rm_seek(RmDecoder *decoder, double seconds);

// Reads stereo float samples, interleaved, at the rate given to rm_open. Returns the frames read, 0
// at the end of the track, or a negative FFmpeg error. Tracks join without a gap because the frames
// returned are exactly the frames of the track, with the encoder's padding removed.
int rm_read_pcm(RmDecoder *decoder, float *samples, int frames);

void rm_close(RmDecoder *decoder);

// Writes a rendition of an open track: AAC-LC in a faststart MP4 at 44.1 kHz stereo. The rate given to
// rm_open must be 44100. seconds of 0 means the whole track, otherwise the first seconds of it. Returns
// 0, or a negative FFmpeg error.
int rm_encode(RmDecoder *decoder, const char *out_path, int kilobits, double seconds);

// The output: one continuous stream of FLAC in fragmented MP4, which a MediaSource plays.
typedef struct RmOutput RmOutput;

// Opens the stream. The first bytes it makes are the init segment.
RmOutput *rm_output_open(int sample_rate);

// Adds stereo float samples, interleaved. Returns 0, or a negative FFmpeg error.
int rm_output_write(RmOutput *output, const float *samples, int frames);

// Ends the current fragment, so the bytes so far can be appended. flush is not zero at the end of the
// stream, when a last short block has to be written.
int rm_output_cut(RmOutput *output, int flush);

// Forgets samples that are waiting for a full block. A key press uses this, so nothing of the old
// track follows into the new one.
void rm_output_drop(RmOutput *output);

// The bytes made so far. rm_output_clear() empties them once the caller has copied them.
const unsigned char *rm_output_data(const RmOutput *output);
int rm_output_size(const RmOutput *output);
void rm_output_clear(RmOutput *output);

void rm_output_close(RmOutput *output);

#endif
