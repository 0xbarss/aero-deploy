/** The part of the vendored uqr generator the dashboard uses. */
export interface UqrEncodeOptions {
  ecc?: "L" | "M" | "Q" | "H";
  border?: number;
}

export interface UqrEncodeResult {
  size: number;
  data: boolean[][];
}

export declare function encode(text: string, options?: UqrEncodeOptions): UqrEncodeResult;
