import { Logger } from "winston";

interface ImportMeta {
  vitest?: {
    describe: Function;
    it: Function;
    expect: Function;
    vi: any;
    beforeEach: Function;
    afterEach: Function;
  };
}

declare global {
  // eslint-disable-next-line no-var
  var logger: Logger; // Declare logger as a global variable
}

export {}; // This is needed to prevent TypeScript from treating this as a global script
