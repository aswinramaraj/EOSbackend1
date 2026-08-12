import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { DOC_TYPE_LABEL, daysBetween, detectTransportSchema } from './transport-schema.util';
import { BUS_DOC_TYPES, type UpsertBusDocumentDto } from './dto/upsert-bus-document.dto';

interface BusRow {
  id: number;
  bus_no: string;
  vehicle_number: string;
}
interface DocRow {
  bus_id: number;
  doc_type: string;
  reference_no: string | null;
  valid_until: Date;
}

type DocState = 'expired' | 'due_soon' | 'valid' | 'missing';

function stateFor(now: Date, validUntil: Date | null): DocState {
  if (!validUntil) return 'missing';
  const d = daysBetween(now, validUntil);
  if (d < 0) return 'expired';
  if (d < 45) return 'due_soon';
  return 'valid';
}

/**
 * Statutory document register — one row per bus, one column per doc_type.
 * Every bus always shows all 5 doc types even when nothing's been entered
 * for it yet ("missing" state), so a gap is visible rather than silently
 * absent from the table.
 */
@Injectable()
export class TransportComplianceService {
  private readonly logger = new Logger(TransportComplianceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getCompliance() {
    try {
      const schema = await detectTransportSchema(this.prisma);
      if (!schema.documents) {
        return { extended: { documents: false }, buses: [] };
      }

      const buses = await this.prisma.$queryRaw<BusRow[]>(Prisma.sql`
        SELECT id, bus_no, vehicle_number FROM buses ORDER BY bus_no ASC
      `);
      const docs = await this.prisma.$queryRaw<DocRow[]>(Prisma.sql`
        SELECT bus_id, doc_type, reference_no, valid_until FROM bus_documents
      `);

      const docsByBus = new Map<number, Map<string, DocRow>>();
      for (const doc of docs) {
        const map = docsByBus.get(doc.bus_id) ?? new Map<string, DocRow>();
        map.set(doc.doc_type, doc);
        docsByBus.set(doc.bus_id, map);
      }

      const now = new Date();
      const result = buses.map((bus) => {
        const busDocs = docsByBus.get(bus.id);
        return {
          bus_id: bus.id,
          bus_no: bus.bus_no,
          vehicle_number: bus.vehicle_number,
          documents: BUS_DOC_TYPES.map((docType) => {
            const row = busDocs?.get(docType);
            return {
              doc_type: docType,
              label: DOC_TYPE_LABEL[docType] ?? docType,
              reference_no: row?.reference_no ?? null,
              valid_until: row?.valid_until ?? null,
              state: stateFor(now, row?.valid_until ?? null),
            };
          }),
        };
      });

      return { extended: { documents: true }, buses: result };
    } catch (err) {
      this.logger.error('DB error loading compliance data', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async upsertDocument(dto: UpsertBusDocumentDto) {
    const schema = await detectTransportSchema(this.prisma);
    if (!schema.documents) {
      throw new NotFoundException({
        message: 'The bus_documents table has not been created yet — see the migration SQL for this feature.',
        errorCode: 'BUS_DOCUMENTS_TABLE_MISSING',
      });
    }

    try {
      const rows = await this.prisma.$queryRaw<DocRow[]>(Prisma.sql`
        INSERT INTO bus_documents (bus_id, doc_type, reference_no, valid_until, updated_at)
        VALUES (${dto.bus_id}, ${dto.doc_type}, ${dto.reference_no ?? null}, ${dto.valid_until}::date, now())
        ON CONFLICT (bus_id, doc_type) DO UPDATE
          SET reference_no = EXCLUDED.reference_no, valid_until = EXCLUDED.valid_until, updated_at = now()
        RETURNING bus_id, doc_type, reference_no, valid_until
      `);
      const row = rows[0];
      this.logger.log(`Bus document upserted: bus=${row.bus_id} type=${row.doc_type}`);
      const now = new Date();
      return {
        doc_type: row.doc_type,
        label: DOC_TYPE_LABEL[row.doc_type] ?? row.doc_type,
        reference_no: row.reference_no,
        valid_until: row.valid_until,
        state: stateFor(now, row.valid_until),
      };
    } catch (err) {
      this.logger.error('DB error upserting bus document', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
