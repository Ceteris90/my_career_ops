/**
 * A request the caller can correct: a bad name, a template that is not there, a
 * shipped template that cannot be changed. Routes answer a refusal with its own
 * message and status, and every other error (a filesystem failure, say, whose
 * message carries an absolute path) with a generic 500.
 */
export class TemplateRefusal extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 422) {
    super(message);
    this.name = "TemplateRefusal";
    this.status = status;
  }
}
