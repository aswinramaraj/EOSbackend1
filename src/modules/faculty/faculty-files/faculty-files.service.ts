import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { extname } from 'node:path';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageProvider } from 'src/modules/storage/storage-provider';

const PHOTO_BUCKET = 'faculty_photos';
const DOCUMENT_BUCKET = 'faculty_documents';

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

/** Signed URLs for the private documents bucket are only valid this long. */
const DOCUMENT_SIGNED_URL_TTL_SECONDS = 300;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Injectable()
export class FacultyFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
  ) {}

  async uploadPhoto(facultyId: number, file: Express.Multer.File | undefined) {
    this.assertFile(file, ALLOWED_PHOTO_MIME_TYPES, MAX_PHOTO_BYTES, 'Photo');
    const faculty = await this.requireFaculty(facultyId, { profile_url: true });

    if (faculty.profile_url) {
      await this.tryDeleteByUrl(PHOTO_BUCKET, faculty.profile_url);
    }

    const ext = extname(file!.originalname) || '.jpg';
    const path = `faculty/${facultyId}/photo-${Date.now()}${ext}`;
    const { url } = await this.storage.upload(
      PHOTO_BUCKET,
      path,
      file!.buffer,
      file!.mimetype,
    );

    await this.prisma.faculty.update({
      where: { id: facultyId },
      data: { profile_url: url },
    });

    return { profile_url: url };
  }

  async removePhoto(facultyId: number) {
    const faculty = await this.requireFaculty(facultyId, { profile_url: true });

    if (faculty.profile_url) {
      await this.tryDeleteByUrl(PHOTO_BUCKET, faculty.profile_url);
    }

    await this.prisma.faculty.update({
      where: { id: facultyId },
      data: { profile_url: null },
    });

    return { profile_url: null };
  }

  async listDocuments(facultyId: number) {
    await this.requireFaculty(facultyId, { id: true });

    const rows = await this.prisma.faculty_documents.findMany({
      where: { faculty_id: facultyId },
      orderBy: { uploaded_at: 'desc' },
    });

    // A signed URL can fail for a row whose underlying object is missing
    // from storage (e.g. seeded/test rows with no real upload behind them).
    // That one row's URL failing shouldn't 500 the whole list and hide every
    // other — genuinely-uploaded — document for this faculty; `url: null`
    // lets the row still show up with its metadata intact.
    return Promise.all(
      rows.map(async (row) => {
        let url: string | null;
        try {
          url = await this.storage.getSignedUrl(
            DOCUMENT_BUCKET,
            row.file_url,
            DOCUMENT_SIGNED_URL_TTL_SECONDS,
          );
        } catch {
          url = null;
        }
        return {
          id: row.id,
          document_type: row.document_type,
          file_name: row.file_name,
          uploaded_at: row.uploaded_at,
          url,
        };
      }),
    );
  }

  async uploadDocument(
    facultyId: number,
    file: Express.Multer.File | undefined,
    documentType: string,
    actorUserId?: number,
  ) {
    this.assertFile(
      file,
      ALLOWED_DOCUMENT_MIME_TYPES,
      MAX_DOCUMENT_BYTES,
      'Document',
    );
    await this.requireFaculty(facultyId, { id: true });

    const path = `faculty/${facultyId}/${Date.now()}-${sanitizeFileName(file!.originalname)}`;
    await this.storage.upload(
      DOCUMENT_BUCKET,
      path,
      file!.buffer,
      file!.mimetype,
    );

    const doc = await this.prisma.faculty_documents.create({
      data: {
        faculty_id: facultyId,
        document_type: documentType,
        file_name: file!.originalname,
        file_url: path,
        uploaded_by_user_id: actorUserId,
      },
    });

    return {
      id: doc.id,
      document_type: doc.document_type,
      file_name: doc.file_name,
      uploaded_at: doc.uploaded_at,
      url: await this.storage.getSignedUrl(
        DOCUMENT_BUCKET,
        path,
        DOCUMENT_SIGNED_URL_TTL_SECONDS,
      ),
    };
  }

  async deleteDocument(facultyId: number, documentId: number) {
    const doc = await this.prisma.faculty_documents.findFirst({
      where: { id: documentId, faculty_id: facultyId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    await this.storage.delete(DOCUMENT_BUCKET, doc.file_url);
    await this.prisma.faculty_documents.delete({ where: { id: documentId } });

    return { id: documentId };
  }

  private async requireFaculty<T extends Record<string, boolean>>(
    id: number,
    select: T,
  ) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id },
      select,
    });
    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }
    return faculty;
  }

  private assertFile(
    file: Express.Multer.File | undefined,
    allowedMimeTypes: string[],
    maxBytes: number,
    label: string,
  ): void {
    if (!file) {
      throw new BadRequestException(`${label} file is required`);
    }
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `${label} must be one of: ${allowedMimeTypes.join(', ')}`,
      );
    }
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `${label} must be under ${Math.round(maxBytes / (1024 * 1024))} MB`,
      );
    }
  }

  /** Best-effort — a photo that was already deleted/never existed shouldn't block the request. */
  private async tryDeleteByUrl(
    bucket: string,
    publicUrl: string,
  ): Promise<void> {
    const marker = `/object/public/${bucket}/`;
    const index = publicUrl.indexOf(marker);
    if (index === -1) return;
    const path = publicUrl.slice(index + marker.length);
    try {
      await this.storage.delete(bucket, path);
    } catch {
      // Old file may already be gone — not worth failing the new upload over.
    }
  }
}
