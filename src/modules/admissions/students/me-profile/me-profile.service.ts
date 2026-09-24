import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { address_type_enum } from 'generated/prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';

const VALID_ADDRESS_TYPES = Object.values(address_type_enum);

@Injectable()
export class MeProfileService {
  private readonly logger = new Logger(MeProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * PUT /me/profile
   *
   * Self-service update of the caller's own `student_contacts` +
   * `student_addresses` rows. Never accepts a student_id from the client —
   * the row is resolved from the authenticated JWT's `sub` (users.id).
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND      – the authenticated user has no linked student record
   *  422 INVALID_ADDRESS_TYPE   – an addresses[].address_type isn't a real enum value
   *  500 INTERNAL_ERROR         – unexpected DB failure
   */
  async updateMyProfile(userId: number, dto: UpdateProfileDto) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    for (const address of dto.addresses ?? []) {
      if (
        !VALID_ADDRESS_TYPES.includes(address.address_type as address_type_enum)
      ) {
        throw new UnprocessableEntityException({
          message: `address_type must be one of: ${VALID_ADDRESS_TYPES.join(', ')}`,
          errorCode: 'INVALID_ADDRESS_TYPE',
        });
      }
    }

    const hasContactFields =
      dto.student_email1 !== undefined ||
      dto.student_email2 !== undefined ||
      dto.student_mobile !== undefined;

    try {
      const [contacts, addresses] = await this.prisma.$transaction(
        async (tx) => {
          const contactsResult = hasContactFields
            ? await tx.student_contacts.upsert({
                where: { student_id: student.id },
                create: {
                  student_id: student.id,
                  student_email1: dto.student_email1,
                  student_email2: dto.student_email2,
                  student_mobile: dto.student_mobile,
                },
                update: {
                  ...(dto.student_email1 !== undefined && {
                    student_email1: dto.student_email1,
                  }),
                  ...(dto.student_email2 !== undefined && {
                    student_email2: dto.student_email2,
                  }),
                  ...(dto.student_mobile !== undefined && {
                    student_mobile: dto.student_mobile,
                  }),
                },
              })
            : await tx.student_contacts.findUnique({
                where: { student_id: student.id },
              });

          const addressResults = dto.addresses?.length
            ? await Promise.all(
                dto.addresses.map((address) =>
                  tx.student_addresses.upsert({
                    where: {
                      student_id_address_type: {
                        student_id: student.id,
                        address_type: address.address_type as address_type_enum,
                      },
                    },
                    create: {
                      student_id: student.id,
                      address_type: address.address_type as address_type_enum,
                      address_line: address.address_line,
                      city: address.city,
                      state: address.state,
                      pincode: address.pincode,
                    },
                    update: {
                      address_line: address.address_line,
                      city: address.city,
                      state: address.state,
                      pincode: address.pincode,
                    },
                  }),
                ),
              )
            : await tx.student_addresses.findMany({
                where: { student_id: student.id },
              });

          return [contactsResult, addressResults] as const;
        },
      );

      return {
        contacts: contacts && {
          student_email1: contacts.student_email1,
          student_email2: contacts.student_email2,
          student_mobile: contacts.student_mobile,
        },
        addresses: addresses.map((address) => ({
          address_type: address.address_type,
          address_line: address.address_line,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
        })),
      };
    } catch (err) {
      this.logger.error(`Failed to update profile for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/profile
   *
   * Assembles the caller's full profile: core `students` record joined to
   * courses/quotas/classes/batches display names, plus every optional
   * detail table Perfect Entry may have written to. `student_sensitive_info`
   * (Aadhar/PAN) is deliberately never selected here — see todo.md's own
   * "Future Improvements" note about a separately-scoped sensitive-info
   * endpoint, not implemented by this pass.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – the authenticated user has no linked student
   *                          record. The spec marks this "not applicable"
   *                          (assumes a students row always exists for a
   *                          student JWT), but the same defensive check as
   *                          PUT /me/profile is kept here for consistency —
   *                          it never fires for a real, correctly-provisioned
   *                          student account.
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyProfile(userId: number) {
    const student = await this.fetchProfileRow(userId);

    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    return {
      student_id_no: student.student_id_no,
      roll_no: student.roll_no,
      register_no: student.register_no,
      course_name: student.courses.name,
      quota_name: student.quotas.name,
      batch_name: student.batches.name,
      class_section: student.classes?.section ?? null,
      current_semester: student.classes?.current_semester ?? null,
      student_type: student.student_type,
      gender: student.gender,
      date_of_birth: student.date_of_birth
        ? student.date_of_birth.toISOString().slice(0, 10)
        : null,
      blood_group: student.blood_group,
      is_first_graduate: student.is_first_graduate,
      addresses: student.student_addresses,
      identity_marks: student.student_identity_marks,
      family_details: student.student_family_details,
      contacts: student.student_contacts,
    };
  }

  private async fetchProfileRow(userId: number) {
    try {
      return await this.prisma.students.findUnique({
        where: { user_id: userId },
        select: {
          student_id_no: true,
          roll_no: true,
          register_no: true,
          student_type: true,
          gender: true,
          date_of_birth: true,
          blood_group: true,
          is_first_graduate: true,
          courses: { select: { name: true } },
          quotas: { select: { name: true } },
          classes: { select: { section: true, current_semester: true } },
          batches: { select: { name: true } },
          student_addresses: {
            select: {
              address_type: true,
              address_line: true,
              city: true,
              state: true,
              pincode: true,
            },
          },
          student_identity_marks: {
            select: { mark_number: true, description: true },
          },
          student_family_details: {
            select: {
              father_name: true,
              father_qualification: true,
              father_occupation: true,
              father_annual_income: true,
              father_email: true,
              father_mobile: true,
              mother_name: true,
              mother_qualification: true,
              mother_occupation: true,
              mother_annual_income: true,
              mother_email: true,
              mother_mobile: true,
            },
          },
          student_contacts: {
            select: {
              student_email1: true,
              student_email2: true,
              student_mobile: true,
            },
          },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to fetch profile for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
