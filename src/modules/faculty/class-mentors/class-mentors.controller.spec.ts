jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubjectRecordsService } from 'src/modules/faculty/subject-records/subject-records.service';
import { NoDueService } from 'src/modules/faculty/no-due/no-due.service';
import { SubjectNoDueService } from 'src/modules/faculty/subject-no-due/subject-no-due.service';
import { StudentHigherEducationService } from 'src/modules/student-higher-education/student-higher-education.service';
import { StudentEntrepreneurshipService } from 'src/modules/student-entrepreneurship/student-entrepreneurship.service';
import { ClassMentorsController } from './class-mentors.controller';
import { ClassMentorsService } from './class-mentors.service';

describe('ClassMentorsController', () => {
  let controller: ClassMentorsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClassMentorsController],
      providers: [
        ClassMentorsService,
        {
          provide: PrismaService,
          useValue: {
            faculty: { findUnique: jest.fn() },
            students: { findUnique: jest.fn() },
            classes: { findUnique: jest.fn() },
            class_mentors: { findFirst: jest.fn(), findMany: jest.fn() },
            student_drive_applications: { findMany: jest.fn() },
            parent_student_mapping: { findFirst: jest.fn() },
          },
        },
        {
          provide: SubjectRecordsService,
          useValue: { findAllForClass: jest.fn() },
        },
        {
          provide: NoDueService,
          useValue: { getStudentsForClass: jest.fn(), approveOverride: jest.fn() },
        },
        {
          provide: SubjectNoDueService,
          useValue: { getAcademicsClearedMap: jest.fn() },
        },
        {
          provide: StudentHigherEducationService,
          useValue: { findAllForClass: jest.fn() },
        },
        {
          provide: StudentEntrepreneurshipService,
          useValue: { findAllForClass: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<ClassMentorsController>(ClassMentorsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
