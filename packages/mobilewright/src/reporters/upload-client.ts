import { mkdtempSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface UploadTestResultParams {
  apiKey: string;
  jsonResultsPath: string;
  outputDir: string;
  name?: string;
  tags?: string[];
  environment?: string;
}

export async function uploadTestResult(params: UploadTestResultParams): Promise<{ url: string }> {
  const uploadDir = mkdtempSync(join(tmpdir(), `mobilewright-upload-${randomUUID()}-`));

  cpSync(params.jsonResultsPath, join(uploadDir, 'results.json'));

  if (existsSync(params.outputDir)) {
    cpSync(params.outputDir, join(uploadDir, 'artifacts'), { recursive: true });
  }

  return { url: `file://${uploadDir}` };
}
