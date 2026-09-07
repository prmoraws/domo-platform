import {
  Pool,
  type QueryResultRow,
} from 'pg';

export type CustomerServiceChannel =
  | 'whatsapp'
  | 'telegram';

export type CustomerServiceRequestType =
  | 'visit'
  | 'pastoral_message'
  | 'other';

export type CustomerServiceRequestStatus =
  | 'collecting'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface CustomerServiceRequest {
  id: number;
  type: CustomerServiceRequestType;
  status: CustomerServiceRequestStatus;
  channel: CustomerServiceChannel;
  contactId: string;

  requesterName: string | null;
  contactWhatsapp: string | null;

  recipient: string | null;
  description: string | null;

  address: string | null;

  prisonerName: string | null;
  prisonName: string | null;
  gallery: string | null;
  sectorModule: string | null;
  cell: string | null;

  currentField: string | null;

  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
}

interface RequestRow extends QueryResultRow {
  id: string;
  type: CustomerServiceRequestType;
  status: CustomerServiceRequestStatus;
  channel: CustomerServiceChannel;
  contact_id: string;

  requester_name: string | null;
  contact_whatsapp: string | null;

  recipient: string | null;
  description: string | null;

  address: string | null;

  prisoner_name: string | null;
  prison_name: string | null;
  gallery: string | null;
  sector_module: string | null;
  cell: string | null;

  current_field: string | null;

  created_at: Date;
  updated_at: Date;
  submitted_at: Date | null;
  completed_at: Date | null;
}

let pool: Pool | undefined;

const required = (
  name: string,
): string => {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Variável obrigatória não configurada: ${name}`,
    );
  }

  return value;
};

const getPool = (): Pool => {
  if (pool) {
    return pool;
  }

  const port =
    Number(
      process.env.CUSTOMER_SERVICE_PG_PORT ??
      5432,
    );

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      'CUSTOMER_SERVICE_PG_PORT inválida',
    );
  }

  pool =
    new Pool({
      host:
        required(
          'CUSTOMER_SERVICE_PG_HOST',
        ),
      port,
      database:
        required(
          'CUSTOMER_SERVICE_PG_DATABASE',
        ),
      user:
        required(
          'CUSTOMER_SERVICE_PG_USER',
        ),
      password:
        required(
          'CUSTOMER_SERVICE_PG_PASSWORD',
        ),
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });

  return pool;
};

const mapRow = (
  row: RequestRow,
): CustomerServiceRequest => ({
  id: Number(row.id),
  type: row.type,
  status: row.status,
  channel: row.channel,
  contactId: row.contact_id,

  requesterName:
    row.requester_name,

  contactWhatsapp:
    row.contact_whatsapp,

  recipient:
    row.recipient,

  description:
    row.description,

  address:
    row.address,

  prisonerName:
    row.prisoner_name,

  prisonName:
    row.prison_name,

  gallery:
    row.gallery,

  sectorModule:
    row.sector_module,

  cell:
    row.cell,

  currentField:
    row.current_field,

  createdAt:
    row.created_at,

  updatedAt:
    row.updated_at,

  submittedAt:
    row.submitted_at,

  completedAt:
    row.completed_at,
});

export const getCollectingRequest =
  async (
    channel: CustomerServiceChannel,
    contactId: string,
  ): Promise<CustomerServiceRequest | null> => {
    const db = getPool();

    const result =
      await db.query<RequestRow>(
        `
          SELECT *
          FROM customer_service.requests
          WHERE channel = $1
            AND contact_id = $2
            AND status = 'collecting'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [
          channel,
          contactId,
        ],
      );

    const row =
      result.rows[0];

    return row
      ? mapRow(row)
      : null;
  };

export const createCollectingRequest =
  async (
    input: {
      type: CustomerServiceRequestType;
      channel: CustomerServiceChannel;
      contactId: string;
      recipient?: string | null;
      currentField: string;
    },
  ): Promise<CustomerServiceRequest> => {
    const db = getPool();

    const result =
      await db.query<RequestRow>(
        `
          INSERT INTO customer_service.requests (
            type,
            channel,
            contact_id,
            recipient,
            current_field
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [
          input.type,
          input.channel,
          input.contactId,
          input.recipient ?? null,
          input.currentField,
        ],
      );

    const row =
      result.rows[0];

    if (!row) {
      throw new Error(
        'PostgreSQL não retornou a solicitação criada',
      );
    }

    return mapRow(row);
  };

export const updateCollectingRequest =
  async (
    id: number,
    fields: Record<
      string,
      string | null
    >,
  ): Promise<CustomerServiceRequest> => {
    const allowed =
      new Map<string, string>([
        [
          'requesterName',
          'requester_name',
        ],
        [
          'contactWhatsapp',
          'contact_whatsapp',
        ],
        [
          'recipient',
          'recipient',
        ],
        [
          'description',
          'description',
        ],
        [
          'address',
          'address',
        ],
        [
          'prisonerName',
          'prisoner_name',
        ],
        [
          'prisonName',
          'prison_name',
        ],
        [
          'gallery',
          'gallery',
        ],
        [
          'sectorModule',
          'sector_module',
        ],
        [
          'cell',
          'cell',
        ],
        [
          'currentField',
          'current_field',
        ],
      ]);

    const entries =
      Object.entries(fields)
        .filter(
          ([key]) =>
            allowed.has(key),
        );

    if (entries.length === 0) {
      throw new Error(
        'Nenhum campo autorizado para atualização',
      );
    }

    const values:
      Array<string | null | number> =
      [id];

    const assignments =
      entries.map(
        ([key, value], index) => {
          values.push(value);

          return `${
            allowed.get(key)
          } = $${index + 2}`;
        },
      );

    const db = getPool();

    const result =
      await db.query<RequestRow>(
        `
          UPDATE customer_service.requests
          SET ${assignments.join(', ')}
          WHERE id = $1
            AND status = 'collecting'
          RETURNING *
        `,
        values,
      );

    const row =
      result.rows[0];

    if (!row) {
      throw new Error(
        'Solicitação em coleta não encontrada',
      );
    }

    return mapRow(row);
  };

export const submitRequest =
  async (
    id: number,
  ): Promise<CustomerServiceRequest> => {
    const db = getPool();

    const result =
      await db.query<RequestRow>(
        `
          UPDATE customer_service.requests
          SET
            status = 'pending',
            current_field = NULL,
            submitted_at = NOW()
          WHERE id = $1
            AND status = 'collecting'
          RETURNING *
        `,
        [id],
      );

    const row =
      result.rows[0];

    if (!row) {
      throw new Error(
        'Solicitação em coleta não encontrada',
      );
    }

    return mapRow(row);
  };

export const closeCustomerServiceRequests =
  async (): Promise<void> => {
    if (!pool) {
      return;
    }

    await pool.end();
    pool = undefined;
  };
