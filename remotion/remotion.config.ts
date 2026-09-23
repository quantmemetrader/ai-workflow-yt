import { Config } from "@remotion/cli/config";

/**
 * Transparency, because everything here is composited over real footage.
 *
 * VP8 in a WebM is the format that carries alpha and that this box's FFmpeg
 * reads without a codec argument; ProRes 4444 would be larger and no better
 * for an overlay that is mostly empty.
 */
Config.setVideoImageFormat("png");
Config.setPixelFormat("yuva420p");
Config.setCodec("vp8");

// Chrome runs as root on this box.
Config.setChromiumOpenGlRenderer("swangle");
