export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response body exceeds the ${maxBytes} byte limit`)
    this.name = 'ResponseTooLargeError'
  }
}
