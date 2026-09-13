/**
 * Hex codec for save data. Uses TextEncoder/TextDecoder instead of Node's Buffer so the exact
 * same module works unmodified in the CLI (Node) and in the browser bundle (esbuild output).
 */

const SAVE_HEADER = '# POKER-SAVE-V1 (hex-encoded JSON — do not edit by hand)';

/** Encodes any JSON-serializable value as a hex string (UTF-8 bytes -> hex digits), no header. */
export function toHex(data: unknown): string {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex;
}

/** Decodes a bare hex string produced by `toHex` back into its original value. */
export function fromHex<T = unknown>(hex: string): T {
    const cleaned = hex.trim().replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]*$/.test(cleaned) || cleaned.length % 2 !== 0) {
        throw new Error('Input is not valid hex data');
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
    }
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
}

/**
 * Serializes any JSON-serializable save payload into the `.hex.txt` format: a human-readable
 * comment header followed by the hex-encoded JSON payload. This is what gets written to disk
 * (CLI) or offered as a browser download (web) — see `exportGameToHex`/`importGameFromHex` in
 * `export.ts` for the poker-specific wrappers built on top of this.
 */
export function exportSaveToHex(save: unknown): string {
    return `${SAVE_HEADER}\n${toHex(save)}\n`;
}

/** Reciprocal of `exportSaveToHex`: strips comment lines/whitespace, then decodes the hex payload. */
export function importSaveFromHex<T = unknown>(hexString: string): T {
    const hex = hexString
        .split('\n')
        .filter((line) => !line.trim().startsWith('#') && line.trim().length > 0)
        .join('');
    return fromHex<T>(hex);
}
