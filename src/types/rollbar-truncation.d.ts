declare module "rollbar/src/truncation" {
  const truncation: {
    truncate: (
      payload: unknown,
      jsonBackup: typeof JSON.stringify,
      maxSize: number,
    ) => { error?: Error; value: string };
  };
  export default truncation;
}
