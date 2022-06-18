/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection } from '@salesforce/core';
import { QueryResult } from 'jsforce';

export const autoFetchQuery = async <T>(
  query: string,
  conn: Connection,
  useTooling = false,
  maxFetch = 50_000
): Promise<QueryResult<T>> => {
  return new Promise((resolve, reject) => {
    const records: T[] = [];
    const res = (useTooling ? conn.tooling : conn)
      .query(query)
      .on('record', (rec) => records.push(rec))
      .on('error', (err) => reject(err))
      .on('end', () => {
        resolve({
          done: true,
          totalSize: res.totalSize ?? 0,
          records,
        });
      })
      .run({ autoFetch: true, maxFetch });
  });
};
