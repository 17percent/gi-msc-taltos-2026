/** A `GET /healthz` válasza. */
export interface HealthResponse {
  status: 'ok';
  version: string;
}
