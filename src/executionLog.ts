/*
 * Copyright (c) 2021, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
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
