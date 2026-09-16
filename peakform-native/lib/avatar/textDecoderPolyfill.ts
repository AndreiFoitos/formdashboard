// three's GLTFLoader decodes the GLB JSON chunk with TextDecoder, which Hermes
// may not provide. Minimal UTF-8 fallback, installed only when missing.

if (typeof (globalThis as { TextDecoder?: unknown }).TextDecoder === 'undefined') {
  class Utf8Decoder {
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (!input) return ''
      const bytes =
        input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      let out = ''
      let i = 0
      while (i < bytes.length) {
        const b = bytes[i++]
        let cp: number
        if (b < 0x80) cp = b
        else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f)
        else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
        else cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
        out += String.fromCodePoint(cp)
      }
      return out
    }
  }
  ;(globalThis as { TextDecoder?: unknown }).TextDecoder = Utf8Decoder
}

export {}
