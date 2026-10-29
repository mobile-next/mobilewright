export class MobilewrightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MobilewrightError';
  }
}
