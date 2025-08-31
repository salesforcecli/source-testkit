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

import { Connection } from '@salesforce/core';
import { JsonCollection, JsonMap, Nullable } from '@salesforce/ts-types';

export type Result<T = JsonCollection> = Nullable<JsonMap & { status: number; result: T }>;

export type Context = {
  projectDir: string;
  connection: Nullable<Connection>;
  nut: string;
  commands: Record<string, string>;
};

export type Commands = Record<string, string>;

export type ApexTestResult = {
  TestTimestamp: string;
  ApexClassId: string;
};

export type ApexClass = {
  Id: string;
  Name: string;
};

export type SourceMember = {
  Id: string;
  MemberName: string;
  MemberType: string;
  RevisionCounter: number;
};

/**
 * NOTICE: The following types are only sufficient for running the NUTs. They are likely incomplete and in some cases incorrect.
 * As we add commands to plugin-source, we should finalize the respective types and move them to the appropriate file location.
 */

export type SourceState = 'Local Add' | 'Local Changed' | 'Remote Add' | 'Remote Changed' | 'Local Deleted';

export type SourceInfo = {
  state: string;
  fullName: string;
  type: string;
  filePath: string;
};

export type StatusResult = SourceInfo[];
