// Minimal ambient module declaration to satisfy TypeScript for adm-zip
declare module 'adm-zip' {
  class AdmZip {
    constructor(filePath?: string);
    getEntries(): Array<{
      entryName: string;
      isDirectory: boolean;
      getData(): Buffer;
    }>;
    extractAllTo(targetPath: string, overwrite?: boolean): void;
    readAsText(fileName: string): string;
  }
  export = AdmZip;
}
