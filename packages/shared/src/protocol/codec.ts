import { Decoder, Encoder } from '@msgpack/msgpack';
import type { ClientMessage, ServerMessage } from '@extract/game-types';

// MessagePack keeps the wire format compact; floats are sent as float32.
const encoder = new Encoder({ forceFloat32: true, ignoreUndefined: true });
const decoder = new Decoder();

export function encodeMessage(msg: ServerMessage | ClientMessage): Uint8Array {
  return encoder.encode(msg);
}

/** Decodes a binary frame. Throws on malformed input; callers must validate the shape. */
export function decodeMessage(data: ArrayBuffer | Uint8Array): unknown {
  return decoder.decode(data instanceof Uint8Array ? data : new Uint8Array(data));
}
