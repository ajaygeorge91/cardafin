// Types for freeze-ports.mjs, so a test can import it without `any`.

export declare function isContractFile(name: string): boolean;
export declare function normalizeSource(source: string): string;
export declare function fingerprint(source: string): string;
export declare function readPortFingerprints(dir?: string): Promise<Record<string, string>>;
export declare function checkPorts(): Promise<string[]>;
