[![NPM](https://img.shields.io/npm/v/@salesforce/source-testkit.svg?label=@salesforce/source-testkit)](https://www.npmjs.com/package/@salesforce/source-testkit) [![CircleCI](https://circleci.com/gh/salesforcecli/source-testkit/tree/main.svg?style=shield&circle-token=da829fc2bc1e3323fa5adb0a7d27a27c1e2ac9ec)](https://circleci.com/gh/salesforcecli/source-testkit/tree/main) [![Downloads/week](https://img.shields.io/npm/dw/@salesforce/source-testkit.svg)](https://npmjs.org/package/@salesforce/source-testkit) [![License](https://img.shields.io/badge/License-BSD%203--Clause-brightgreen.svg)](https://raw.githubusercontent.com/salesforcecli/source-testkit/main/LICENSE.txt)

# Description

The @salesforce/source-testkit library wraps around [@salesforce/cli-plugins-testkit](https://github.com/salesforcecli/cli-plugins-testkit) to provide a simple interface for Salesforce CLI plug-in authors to compose source (e.g. deploy, retrieve, push, and pull) related non-unit-tests (NUTs).

Specifically, [`SourceTestKit`](src/testkit.ts) provides the following conveniences:

1. Wrapper methods for the `source` CLI commands. For example, the `force:source:deploy` and `force:source:retrieve` commands can be invoked like so:
   ```typescript
   const sourceTestkit = await SourceTestkit.create({
     repository: 'https://github.com/trailheadapps/dreamhouse-lwc.git',
     nut: __filename,
   });
   sourceTestkit.deploy({ args: `--sourcepath force-app` });
   sourceTestkit.retrieve({ args: `--sourcepath force-app` });
   ```
2. [Common assertions](src/assertions.ts) like expecting a file to be deployed or expecting a file to be retrieved. These are all accessible under `sourceTestkit.expect`. For example:
   ```typescript
   const sourceTestkit = await SourceTestkit.create({
     repository: 'https://github.com/trailheadapps/dreamhouse-lwc.git',
     nut: __filename,
   });
   sourceTestkit.deploy({ args: `--sourcepath force-app` });
   sourceTestkit.expect.filesToBeDeployed('force-app/**/*');
   ```
   **NOTE** When providing files paths to these assertion methods, you need to provide a [glob pattern](https://github.com/mrmlnc/fast-glob#pattern-syntax), NOT an OS specific file path. We have chosen this approach because it provides a lot of flexibilty when writing tests and because it's OS agnostic.

# Usage

Add this library as a dev dependencies to your project.

```bash
yarn add @salesforcecli/source-testkit --dev
```

# Examples

```typescript
import { SourceTestkit } from '@salesforce/source-testkit';

context('Deploy from source path NUT', () => {
  let sourceTestkit: SourceTestkit;

  before(async () => {
    sourceTestkit = await SourceTestkit.create({
      repository: 'https://github.com/trailheadapps/dreamhouse-lwc.git',
      nut: __filename,
    });
  });

  after(async () => {
    await sourceTestkit?.clean();
  });

  describe('--sourcepath flag', () => {
    it(`should deploy force-app`, async () => {
      await sourceTestkit.deploy({ args: `--sourcepath force-app` });
      await sourceTestkit.expect.filesToBeDeployed('force-app/**/*');
    });

    it('should throw an error if the sourcepath is not valid', async () => {
      const deploy = await sourceTestkit.deploy({ args: '--sourcepath DOES_NOT_EXIST', exitCode: 1 });
      sourceTestkit.expect.errorToHaveName(deploy, 'SourcePathInvalid');
    });
  });
});
```
