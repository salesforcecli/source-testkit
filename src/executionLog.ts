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

import { ensureString } from '@salesforce/ts-types';
import { Context, SourceMember } from './types';

/**
 * This class maintains a map of command execution history.
 *
 * This is helpful for collecting important information before a command is executed (e.g. SourceMember information)
 */
export class ExecutionLog {
  public log: ExecutionLog.Log = new Map<string, ExecutionLog.Details[]>();

  public constructor(private context: Context) {}

  /**
   * Add a command to the execution log
   */
  public async add(cmd: string): Promise<void> {
    const baseCmd = ensureString(
      Object.values(this.context.commands).find((c) => cmd.startsWith(c)) ?? cmd.split(' -')[0]
    );
    const existingEntries = this.log.get(baseCmd) ?? [];
    const sourceMembers =
      baseCmd.includes(this.context.commands.deploy) || baseCmd.includes(this.context.commands.push)
        ? await this.querySourceMembers()
        : [];
    const newEntry = {
      timestamp: new Date(),
      fullCommand: cmd,
      sourceMembers,
    };

    this.log.set(baseCmd, [...existingEntries, newEntry]);
  }

  /**
   * Return the most recent timestamp for a command
   */
  public getLatestTimestamp(cmd: string): Date {
    return this.getLatest(cmd).timestamp;
  }

  /**
   * Return the most recent entry for a command
   */
  public getLatest(cmd: string): ExecutionLog.Details {
    const log = this.log.get(cmd) ?? [];
    const sorted = log.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return sorted[0];
  }

  private async querySourceMembers(): Promise<SourceMember[]> {
    const query = 'SELECT Id,MemberName,MemberType,RevisionCounter FROM SourceMember';
    const result = await this.context.connection?.tooling.query<SourceMember>(query, {
      autoFetch: true,
      maxFetch: 50_000,
    });
    return result?.records ?? [];
  }
}

export namespace ExecutionLog {
  export type Log = Map<string, ExecutionLog.Details[]>;

  export type Details = {
    timestamp: Date;
    fullCommand: string;
    sourceMembers: SourceMember[];
  };
}
