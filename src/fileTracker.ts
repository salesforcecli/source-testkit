/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Nullable } from '@salesforce/ts-types';
import { Context } from './types';

/* eslint-disable no-await-in-loop */

/**
 * This class maintains a map of tracked files. This is particularly useful
 * for determining if files have changed after a command has been executed
 */
export class FileTracker {
  private files = new Map<string, FileTracker.FileHistory[]>();
  public constructor(private context: Context) {}

  /**
   * Add a file to be tracked
   */
  public async track(file: string): Promise<void> {
    const entry = {
      annotation: 'initial state',
      hash: await this.getContentHash(file),
      changedFromPrevious: false,
      name: file,
    };
    this.files.set(file, [entry]);
  }

  /**
   * Returns tracked file's history
   */
  public get(file: string): FileTracker.FileHistory[] {
    return this.files.get(file) ?? [];
  }

  /**
   * Returns latest entry for file
   */
  public getLatest(file: string): Nullable<FileTracker.FileHistory> {
    const history = this.files.get(file);
    return history ? history[history.length - 1] : null;
  }

  /**
   * Update the file history for given file. Annotation is required since
   * it is useful for debugging/understanding a file's history
   */
  public async update(file: string, annotation: string): Promise<void> {
    if (!this.files.has(file)) {
      await this.track(file);
      return;
    }
    const latestHash = await this.getContentHash(file);
    const entries = this.files.get(file)!;
    const lastEntry = entries[entries.length - 1];
    const newEntry = {
      annotation,
      hash: latestHash,
      changedFromPrevious: lastEntry.hash !== latestHash,
      name: file,
    };

    this.files.set(file, [...entries, newEntry]);
  }

  /**
   * Update the history for all tracked files. Annotation is required since
   * it is useful for debugging/understanding a file's history
   */
  public async updateAll(annotation: string): Promise<void> {
    const files = this.files.keys();
    for (const file of files) {
      await this.update(file, annotation);
    }
  }

  private async getContentHash(file: string): Promise<Nullable<string>> {
    const filePath = this.getFullPath(file);
    try {
      const filestat = await fs.promises.stat(filePath);
      const isDirectory = filestat.isDirectory();
      const contents = isDirectory
        ? (await fs.promises.readdir(filePath)).toString()
        : await fs.promises.readFile(filePath);
      return crypto.createHash('sha1').update(contents).digest('hex');
    } catch {
      return null;
    }
  }

  private getFullPath(file: string): string {
    return file.includes(this.context.projectDir) ? file : path.join(this.context.projectDir, file);
  }
}

export namespace FileTracker {
  export type FileHistory = {
    annotation: string;
    hash: Nullable<string>;
    changedFromPrevious: boolean;
    name: string;
  };
}

/**
 * Returns all files in directory that match the filter
 */
export async function traverseForFiles(dirPath: string, regexFilter = /./, allFiles: string[] = []): Promise<string[]> {
  const files = await fs.promises.readdir(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      allFiles = await traverseForFiles(filePath, regexFilter, allFiles);
    } else if (regexFilter.test(file)) {
      allFiles.push(path.join(dirPath, file));
    }
  }
  return allFiles;
}

/**
 * Returns the number of files found in directories that match the filter
 */
export async function countFiles(directories: string[], regexFilter = /./): Promise<number> {
  let fileCount = 0;
  for (const dir of directories) {
    fileCount += (await traverseForFiles(dir, regexFilter)).length;
  }
  return fileCount;
}
