/*
 * Copyright (c) 2021, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

/* eslint-disable no-console */

import * as path from 'path';
import * as os from 'os';
import * as fg from 'fast-glob';
import { exec, find, mv, rm, which } from 'shelljs';
import { TestSession, execCmd } from '@salesforce/cli-plugins-testkit';
import { Env, set } from '@salesforce/kit';
import { AnyJson, Dictionary, ensureString, JsonMap, Nullable } from '@salesforce/ts-types';
import { AuthInfo, Connection, fs, NamedPackageDir, SfdxProject } from '@salesforce/core';
import { AsyncCreatable } from '@salesforce/kit';
import { debug, Debugger } from 'debug';
import { MetadataResolver } from '@salesforce/source-deploy-retrieve';
import { Commands, Result, StatusResult } from './types';
import { Assertions } from './assertions';
import { ExecutionLog } from './executionLog';
import { FileTracker, traverseForFiles } from './fileTracker';

/**
 * SourceTestkit is a class that is designed to make composing source NUTs easy and painless
 *
 * It provides the following functionality:
 * 1. Methods that wrap around source commands, e.g. SourceTestkit.deploy wraps around force:source:deploy
 * 2. Access to commonly used assertions (provided by the Assertions class)
 * 3. Ability to track file history (provided by the FileTracker class)
 * 4. Ability to modify remote metadata
 * 5. Ability to add local metadata
 * 6. Miscellaneous helper methods
 *
 * To see debug logs for command executions set these env vars:
 * - DEBUG=sourceTestkit:* (for logs from all nuts)
 * - DEBUG=sourceTestkit:<filename.nut.ts> (for logs from specific nut)
 * - DEBUG_DEPTH=8
 */
export class SourceTestkit extends AsyncCreatable<SourceTestkit.Options> {
  public static Env = new Env();
  private static DefaultCmdOpts: SourceTestkit.CommandOpts = {
    exitCode: 0,
    args: '',
    json: true,
  };
  private static LocalDevPath = path.join('bin', 'dev');
  private static LocalProdPath = path.join('bin', 'run');

  public packages!: NamedPackageDir[];
  public packageNames!: string[];
  public packagePaths!: string[];
  public packageGlobs!: string[];
  public projectDir!: string;
  public expect!: Assertions;
  public testMetadataFolder!: string;
  public testMetadataFiles!: string[];
  public username!: string;

  private commands!: Commands;
  private connection: Nullable<Connection>;
  private debug: Debugger;
  private executable: string;
  private fileTracker!: FileTracker;
  private repository: string;
  private session!: TestSession;
  private orgless: boolean;
  private executionLog!: ExecutionLog;
  private nut: string;
  private metadataResolver!: MetadataResolver;

  public constructor(options: SourceTestkit.Options) {
    super(options);
    this.executable = options.executable || which('sfdx').stdout;
    this.repository = options.repository;
    this.orgless = !!options.orgless;
    this.nut = path.basename(options.nut);
    this.debug = debug(`sourceTestkit:${this.nut}`);
  }

  /**
   * Cleans the test session
   */
  public async clean(): Promise<void> {
    SourceTestkit.Env.unset('TESTKIT_EXECUTABLE_PATH');
    await this.session?.clean();
  }

  /**
   * Executes force:source:convert
   */
  public async convert(options: Partial<SourceTestkit.CommandOpts> = {}): Promise<Result> {
    return this.execute('force:source:convert', options);
  }

  /**
   * Executes force:source:deploy
   */
  public async deploy(options: Partial<SourceTestkit.CommandOpts> = {}): Promise<Result<{ id: string }>> {
    return this.execute<{ id: string }>(this.getCommandString('deploy'), options);
  }

  /**
   * Executes force:source:deploy:report
   */
  public async deployReport(options: Partial<SourceTestkit.CommandOpts> = {}): Promise<Result<{ id: string }>> {
    return this.execute<{ id: string }>(this.getCommandString('deployReport'), options);
  }

  /**
   * Executes force:source:deploy:cancel
   */
  public async deployCancel(options: Partial<SourceTestkit.CommandOpts> = {}): Promise<Result<{ id: string }>> {
    return this.execute<{ id: string }>(this.getCommandString('deployCancel'), options);
  }

  /**
   * Executes force:source:retrieve
   */
  public async retrieve(options: Partial<SourceTestkit.CommandOpts> = {}): Promise<Result> {
    return this.execute(this.getCommandString('retrieve'), options);
  }

  /**
   * Executes force:source:push
   */
  public async push(options: Partial<SourceTestkit.CommandOpts> = {}): Promise<Result> {
    return this.execute(this.getCommandString('push'), options);
  }

  /**
   * Executes force:source:pull
   */
  public async pull(options: Partial<SourceTestkit.CommandOpts> = {}): Promise<Result> {
    return this.execute(this.getCommandString('pull'), options);
  }

  /**
   * Executes force:source:status
   */
  public async status(options: Partial<SourceTestkit.CommandOpts> = {}): Promise<Result<StatusResult>> {
    return this.execute<StatusResult>(this.getCommandString('status'), options);
  }

  /**
   * Create an apex class
   */
  public async createApexClass(
    options: Partial<SourceTestkit.CommandOpts> = {}
  ): Promise<Result<{ created: string[]; outputDir: string }>> {
    return this.execute('force:apex:class:create', options);
  }

  /**
   * Create a Lightning Web Component
   */
  public async createLWC(
    options: Partial<SourceTestkit.CommandOpts> = {}
  ): Promise<Result<{ created: string[]; outputDir: string }>> {
    return this.execute('force:lightning:component:create', options);
  }

  /**
   * Installs a package into the scratch org. This method uses shelljs instead of testkit because
   * we can't add plugin-package as a dev plugin yet.
   */
  public installPackage(id: string): void {
    exec(`sfdx force:package:install --noprompt --package ${id} --wait 5 --json 2> /dev/null`, { silent: true });
  }

  /**
   * Runs the permset:assign command with the passed in options
   *
   * @param options
   */
  public async assignPermissionSet(
    options: Partial<SourceTestkit.CommandOpts> = {}
  ): Promise<Result<{ success: [{ name: string; value: string }]; failures: [{ name: string; value: string }] }>> {
    return await this.execute('force:user:permset:assign', options);
  }

  /**
   * Adds given files to FileTracker for tracking
   */
  public async trackFiles(files: string[]): Promise<void> {
    for (const file of files) {
      await this.fileTracker.track(file);
    }
  }

  /**
   * Adds files found by globs to FileTracker for tracking
   */
  public async trackGlobs(globs: string[]): Promise<void> {
    const files = await this.doGlob(globs);
    for (const file of files) {
      await this.fileTracker.track(file);
    }
  }

  /**
   * Read files found by globs
   */
  public async readGlobs(globs: string[]): Promise<Dictionary<string>> {
    const files = await this.doGlob(globs);
    const returnValue: Dictionary<string> = {};
    for (const file of files) {
      returnValue[file] = await fs.readFile(file, 'UTF-8');
    }
    return returnValue;
  }

  /**
   * Read the org's sourcePathInfos.json
   */
  public async readSourcePathInfos(): Promise<AnyJson> {
    const sourcePathInfosPath = path.join(this.projectDir, '.sfdx', 'orgs', this.username, 'sourcePathInfos.json');
    return fs.readJson(sourcePathInfosPath);
  }

  /**
   * Read the org's maxRevision.json
   */
  public async readMaxRevision(): Promise<{ sourceMembers: JsonMap }> {
    const maxRevisionPath = path.join(this.projectDir, '.sfdx', 'orgs', this.username, 'maxRevision.json');
    return fs.readJson(maxRevisionPath) as unknown as { sourceMembers: JsonMap };
  }

  /**
   * Write the org's maxRevision.json
   */
  public async writeMaxRevision(contents: JsonMap): Promise<void> {
    const maxRevisionPath = path.join(this.projectDir, '.sfdx', 'orgs', this.username, 'maxRevision.json');
    return fs.writeJson(maxRevisionPath, contents);
  }

  /**
   * Write file
   */
  public async writeFile(filename: string, contents: string): Promise<void> {
    return fs.writeFile(filename, contents);
  }

  /**
   * Create a package.xml
   */
  public async createPackageXml(xml: string): Promise<string> {
    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    ${xml}
    <version>51.0</version>
</Package>
    `;
    const packageXmlPath = path.join(this.projectDir, 'package.xml');
    await fs.writeFile(packageXmlPath, packageXml);
    return packageXmlPath;
  }

  /**
   * Delete the org's sourcePathInfos.json
   */
  public async deleteSourcePathInfos(): Promise<void> {
    const sourcePathInfosPath = path.join(this.projectDir, '.sfdx', 'orgs', this.username, 'sourcePathInfos.json');
    return fs.unlink(sourcePathInfosPath);
  }

  /**
   * Delete the org's maxRevision.json
   */
  public async deleteMaxRevision(): Promise<void> {
    const maxRevisionPath = path.join(this.projectDir, '.sfdx', 'orgs', this.username, 'maxRevision.json');
    return fs.unlink(maxRevisionPath);
  }

  /**
   * Delete the files found by the given globs
   */
  public async deleteGlobs(globs: string[]): Promise<void> {
    const files = await this.doGlob(globs);
    for (const file of files) {
      await fs.unlink(file);
    }
  }

  /**
   * Delete all source files in the project directory
   */
  public async deleteAllSourceFiles(): Promise<void> {
    for (const pkg of this.packagePaths) {
      await fs.rmdir(pkg, { recursive: true });
      await fs.mkdirp(pkg);
    }
  }

  /**
   * Modify files found by given globs
   */
  public async modifyLocalGlobs(globs: string[], append = os.EOL): Promise<void> {
    const allFiles = await this.doGlob(globs);

    for (const file of allFiles) {
      await this.modifyLocalFile(path.normalize(file), append);
    }
  }

  /**
   * Modify file by appending to the end of the file. Defaults to appending a new line.
   */
  public async modifyLocalFile(file: string, append = os.EOL): Promise<void> {
    const fullPath = file.startsWith(this.projectDir) ? file : path.join(this.projectDir, file);
    let contents = await fs.readFile(fullPath, 'UTF-8');
    contents += append;
    await fs.writeFile(fullPath, contents);
    await this.fileTracker.update(fullPath, 'modified file');
  }

  /**
   * Modify a remote file
   *
   * This presumes that there is a QuickAction called NutAction in
   * the test metadata. Ideally this method would be able to update
   * any metadata type with any name
   */
  public async modifyRemoteFile(): Promise<string> {
    const result: Array<{ Id?: string | undefined }> = (await this.connection?.tooling
      .sobject('QuickActionDefinition')
      .find({ DeveloperName: 'NutAction' }, ['ID']))!;
    const updateRequest = {
      Id: result[0].Id,
      Description: 'updated description',
    };
    await this.connection?.tooling.sobject('QuickActionDefinition').update(updateRequest);
    return this.testMetadataFiles.find((f) => f.endsWith('NutAction.quickAction-meta.xml'))!;
  }

  /**
   * Adds test files (located in the test/nuts/metadata folder) to the project directory
   */
  public async addTestFiles(): Promise<void> {
    for (const file of this.testMetadataFiles) {
      const dest = path.join(this.projectDir, file);
      const src = path.join(this.testMetadataFolder, file);
      this.debug(`addTestFiles: ${src} -> ${dest}`);
      try {
        fs.copyFileSync(src, dest);
      } catch {
        await fs.mkdirp(path.dirname(dest));
        fs.copyFileSync(src, dest);
      }
    }
    await this.trackFiles(this.testMetadataFiles);
  }

  /**
   * Spoof a remote change in the org by setting the lastRetrievedFromServer
   * property in the local maxRevision.json to null
   */
  public async spoofRemoteChange(globs: string[]): Promise<void> {
    const files = await this.doGlob(globs);
    const maxRevision = await this.readMaxRevision();
    for (const file of files) {
      const component = this.metadataResolver.getComponentsFromPath(file)[0];
      const parent = component.parent?.name;
      const type = component.type.name;
      const name = component.name;
      if (!type.includes('CustomLabel')) {
        const maxRevisionKey = parent ? `${type}__${parent}.${name}` : `${type}__${name}`;
        set(maxRevision.sourceMembers, `${maxRevisionKey}.lastRetrievedFromServer`, null);
      } else {
        const labels = Object.keys(maxRevision.sourceMembers).filter((k) => k.startsWith('CustomLabel'));
        labels.forEach((label) => {
          set(maxRevision.sourceMembers, `${label}.lastRetrievedFromServer`, null);
        });
      }
    }
    await this.writeMaxRevision(maxRevision);
  }

  /**
   * Returns true if the executable being used belongs to a local pacakage
   */
  public isLocalExecutable(): boolean {
    return (
      this.executable.endsWith(SourceTestkit.LocalDevPath) || this.executable.endsWith(SourceTestkit.LocalProdPath)
    );
  }

  /**
   * Move the manifest file to the current working directory.
   *
   * This is used because the SDR library does not output the package.xml
   * in the same location as toolbelt so we have to find it within the output
   * dir, move it, and delete the generated dir.
   */
  public findAndMoveManifest(dir: string): void {
    const manifest = find(dir).filter((file) => file.endsWith('package.xml'));
    if (!manifest?.length) {
      throw Error(`Did not find package.xml within ${dir}`);
    }
    mv(manifest[0], path.join(process.cwd()));
    rm('-rf', dir);
  }

  /**
   * Execute a command using testkit. Adds --json to every command to ensure json output.
   */
  public async execute<T = JsonMap>(
    cmd: string,
    options: Partial<SourceTestkit.CommandOpts> = {}
  ): Promise<Nullable<Result<T>>> {
    try {
      const { args, exitCode, json } = Object.assign({}, SourceTestkit.DefaultCmdOpts, options);
      const command = (json ? [cmd, args, '--json'] : [cmd, args]).join(' ');
      this.debug(`${command} (expecting exit code: ${exitCode})`);
      await this.fileTracker.updateAll(`PRE: ${command}`);
      await this.executionLog.add(command);
      const result = execCmd<T>(command, { ensureExitCode: exitCode });
      await this.fileTracker.updateAll(`POST: ${command}`);

      if (json) {
        const jsonOutput = result.jsonOutput;
        this.debug('%O', jsonOutput);
        if (!jsonOutput) {
          console.error(`${command} returned null jsonOutput`);
          console.error(result);
        } else {
          this.expect.toHaveProperty(jsonOutput, 'status');
          if (jsonOutput.status === 0) {
            this.expect.toHaveProperty(jsonOutput, 'result');
          }
          return jsonOutput;
        }
      }
    } catch (err) {
      await this.handleError(err);
    }
  }

  protected async init(): Promise<void> {
    if (!SourceTestkit.Env.getString('TESTKIT_HUB_USERNAME') && !SourceTestkit.Env.getString('TESTKIT_AUTH_URL')) {
      ensureString(SourceTestkit.Env.getString('TESTKIT_JWT_KEY'));
      ensureString(SourceTestkit.Env.getString('TESTKIT_JWT_CLIENT_ID'));
      ensureString(SourceTestkit.Env.getString('TESTKIT_HUB_INSTANCE'));
    }

    SourceTestkit.Env.setString('TESTKIT_EXECUTABLE_PATH', this.executable);

    try {
      this.commands = await this.getCommandMapping();
      this.metadataResolver = new MetadataResolver();
      this.session = await this.createSession();
      this.projectDir = this.session.project!.dir;
      const sfdxProject = await SfdxProject.resolve(this.projectDir);
      this.packages = sfdxProject.getPackageDirectories();
      this.packageNames = this.packages.map((p) => p.name);
      this.packagePaths = this.packages.map((p) => p.fullPath);
      this.packageGlobs = this.packages.map((p) => `${p.path}/**/*`);
      this.username = this.getDefaultUsername();
      this.connection = await this.createConnection();
      const context = {
        connection: this.connection,
        projectDir: this.projectDir,
        nut: this.nut,
        commands: this.commands,
      };
      this.fileTracker = new FileTracker(context);
      this.executionLog = new ExecutionLog(context);
      this.expect = new Assertions(context, this.executionLog, this.fileTracker);
      this.testMetadataFolder = path.join(__dirname, 'metadata');
      this.testMetadataFiles = (await traverseForFiles(this.testMetadataFolder))
        .filter((f) => !f.endsWith('.DS_Store'))
        .map((f) => f.replace(`${this.testMetadataFolder}${path.sep}`, ''));
    } catch (err) {
      await this.handleError(err, true);
    }
  }

  private async getCommandMapping(): Promise<Commands> {
    if (this.isLocalExecutable()) {
      const npmPackagePath = this.executable
        .replace(SourceTestkit.LocalProdPath, '')
        .replace(SourceTestkit.LocalDevPath, '');
      const pkgJsonPath = path.join(npmPackagePath, 'package.json');
      const pkgJson = (await fs.readJsonMap(pkgJsonPath)) as { oclif: { bin: string } };
      const key = pkgJson.oclif.bin as EXECUTABLE;
      return COMMANDS[key];
    } else {
      const key = path.basename(this.executable) as EXECUTABLE;
      return COMMANDS[key];
    }
  }

  private getCommandString(cmdKey: string): string {
    const cmd = this.commands[cmdKey];
    if (cmd) {
      return cmd;
    } else {
      throw new Error(`${cmdKey} command not implemented for executable ${this.executable}`);
    }
  }

  /**
   * Log error to console with helpful debugging information
   */
  private async handleError(err: Error, clean = false): Promise<never> {
    const header = `  ENCOUNTERED ERROR IN: ${this.debug.namespace}  `;
    console.log('-'.repeat(header.length));
    console.log(header);
    console.log('-'.repeat(header.length));
    console.log('session:', this.session?.dir);
    console.log('username:', this.username);
    console.log(err);
    console.log('-'.repeat(header.length));
    if (clean) await this.clean();
    throw err;
  }

  private async createSession(): Promise<TestSession> {
    const setupCommands = this.orgless
      ? []
      : [
          'sfdx config:set restDeploy=false --global',
          'sfdx force:org:create -d 1 -s -f config/project-scratch-def.json',
        ];
    return await TestSession.create({
      project: { gitClone: this.repository },
      setupCommands,
      retries: 2,
    });
  }

  private getDefaultUsername(): string {
    const configResult = execCmd<Array<{ key: string; value: string }>>('config:get defaultusername --json')!;
    const result = configResult.jsonOutput?.result;
    return result!.find((r) => r.key === 'defaultusername')!.value;
  }

  private async createConnection(): Promise<Nullable<Connection>> {
    if (this.orgless) return;
    return await Connection.create({
      authInfo: await AuthInfo.create({ username: this.username }),
    });
  }

  private async doGlob(globs: string[]): Promise<string[]> {
    const dir = this.projectDir.replace(/\\/g, '/');
    const fullGlobs = globs.map((g) => {
      g = g.replace(/\\/g, '/');
      if (g.startsWith('!')) {
        g = g.substr(1).startsWith(dir) ? `!${g}` : [`!${dir}`, g].join('/');
      } else {
        g = g.startsWith(dir) ? g : [dir, g].join('/');
      }
      return g;
    });
    return fg(fullGlobs);
  }
}

export namespace SourceTestkit {
  export type Options = {
    readonly executable?: string;
    readonly repository: string;
    readonly nut: string;
    readonly orgless?: boolean;
  };

  export type CommandOpts = {
    exitCode: number;
    args: string;
    json: boolean;
  };
}

export enum EXECUTABLE {
  SFDX = 'sfdx',
  SF = 'sf',
}

export const COMMANDS = {
  [EXECUTABLE.SFDX]: {
    deploy: 'force:source:deploy',
    deployReport: 'force:source:deploy:report',
    deployCancel: 'force:source:deploy:cancel',
    retrieve: 'force:source:retrieve',
    convert: 'force:source:convert',
    push: 'force:source:push',
    pull: 'force:source:pull',
    status: 'force:source:status',
  },
  [EXECUTABLE.SF]: {
    deploy: 'project deploy org',
  },
};
