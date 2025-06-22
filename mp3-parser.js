var mp3Parser = {};

mp3Parser.readFrameHeader = function(data, offset) {
    if (data.length < offset + 4) return null;
    var headerB1 = data[offset];
    var headerB2 = data[offset + 1];
    var headerB3 = data[offset + 2];
    var headerB4 = data[offset + 3];
    if (headerB1 !== 0xff || (headerB2 & 0xe0) !== 0xe0) return null;

    var mpegVersionBits = (headerB2 & 0x18) >> 3;
    var layerBits = (headerB2 & 0x06) >> 1;
    var bitrateBits = (headerB3 & 0xf0) >> 4;
    var samplingRateBits = (headerB3 & 0x0c) >> 2;
    var paddingBit = (headerB3 & 0x02) >> 1;

    var versions = [2.5, null, 2, 1];
    var layers = [null, 3, 2, 1];
    var bitrates = [
        [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
        [null, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
        [null, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
    ];
    var samplingRates = [
        [11025, 12000, 8000, null],
        [null, null, null, null],
        [22050, 24000, 16000, null],
        [44100, 48000, 32000, null]
    ];

    var version = versions[mpegVersionBits];
    var layer = layers[layerBits];
    if (!version || !layer) return null;
    var bitrate = bitrates[layer][bitrateBits];
    var samplingRate = samplingRates[mpegVersionBits][samplingRateBits];
    if (!bitrate || !samplingRate) return null;
    var frameLength = Math.floor((144000 * bitrate * 1000 / samplingRate) + paddingBit);

    return {
        mpegVersion: version,
        layer: layer,
        bitrate: bitrate,
        samplingRate: samplingRate,
        padding: paddingBit,
        frameLength: frameLength
    };
};
