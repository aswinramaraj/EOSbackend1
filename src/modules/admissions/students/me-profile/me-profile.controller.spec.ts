import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ROLES } from 'src/common/constants/roles.constant';
import { ROLES_KEY } from 'src/auth/decorators/roles.decorator';
import { MeController } from './me-profile.controller';
import { MeProfileService } from './me-profile.service';
import { MeAttendanceService } from './me-attendance.service';
import { MeExamResultsService } from './me-exam-results.service';
import { MeLeavesService } from './me-leaves.service';
import { MeLeavesListService } from './me-leaves-list.service';
import { MeOdTeamsService } from './me-od-teams.service';
import { MeOdTeamsListService } from './me-od-teams-list.service';
import { MeOdRequestsService } from './me-od-requests.service';
import { MeOdRequestsListService } from './me-od-requests-list.service';
import { MeOdAttachmentsService } from './me-od-attachments.service';
import { MeHostelOutingsService } from './me-hostel-outings.service';
import { MeCampusOutingsService } from './me-campus-outings.service';
import { MeBonafideRequestsService } from './me-bonafide-requests.service';
import { MeProjectsService } from './me-projects.service';
import { MeFacultyDirectoryService } from './me-faculty-directory.service';
import { MeFeesService } from './me-fees.service';
import { MeExamScheduleService } from './me-exam-schedule.service';
import { MeHostelRoomService } from './me-hostel-room.service';
import { MeHostelComplaintsService } from './me-hostel-complaints.service';
import { MeMessFeedbackService } from './me-mess-feedback.service';
import { MeAcademicCalendarService } from './me-academic-calendar.service';
import { MeAcademicClearanceService } from './me-academic-clearance.service';
import { student_leave_status_enum } from 'generated/prisma/client';

describe('MeController', () => {
  let controller: MeController;
  const meProfileService = {
    updateMyProfile: jest.fn(),
    getMyProfile: jest.fn(),
  };
  const meAttendanceService = {
    getMyAttendance: jest.fn(),
  };
  const meLeavesService = {
    createLeave: jest.fn(),
  };
  const meLeavesListService = {
    getMyLeaves: jest.fn(),
  };
  const meOdTeamsService = {
    createOdTeam: jest.fn(),
    joinOdTeam: jest.fn(),
    removeOdTeamMember: jest.fn(),
    submitOdRequest: jest.fn(),
  };
  const meOdRequestsService = {
    getOdRequestStatus: jest.fn(),
  };
  const meOdAttachmentsService = {
    upload: jest.fn(),
  };
  const meHostelOutingsService = {
    createHostelOuting: jest.fn(),
    getMyHostelOutings: jest.fn(),
  };
  const meCampusOutingsService = {
    createCampusOuting: jest.fn(),
    getMyCampusOutings: jest.fn(),
  };
  const meBonafideRequestsService = {
    createBonafideRequest: jest.fn(),
    getMyBonafideRequests: jest.fn(),
  };
  const meProjectsService = {
    createProject: jest.fn(),
    getMyProjects: jest.fn(),
  };
  const meExamResultsService = {
    getMyExamResults: jest.fn(),
  };
  const meOdTeamsListService = {
    getMyOdTeams: jest.fn(),
  };
  const meOdRequestsListService = {
    getMyOdRequests: jest.fn(),
  };
  const meFacultyDirectoryService = {
    getFacultyDirectory: jest.fn(),
  };
  const meFeesService = {
    getMyFees: jest.fn(),
  };
  const meExamScheduleService = {
    getMyExamSchedule: jest.fn(),
  };
  const meHostelRoomService = {
    getMyHostelRoom: jest.fn(),
  };
  const meHostelComplaintsService = {
    createComplaint: jest.fn(),
  };
  const meMessFeedbackService = {
    createFeedback: jest.fn(),
  };
  const meAcademicCalendarService = {
    getMyAcademicCalendar: jest.fn(),
  };
  const meAcademicClearanceService = {
    getMyAcademicClearance: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeController],
      providers: [
        { provide: MeProfileService, useValue: meProfileService },
        { provide: MeAttendanceService, useValue: meAttendanceService },
        { provide: MeExamResultsService, useValue: meExamResultsService },
        { provide: MeLeavesService, useValue: meLeavesService },
        { provide: MeLeavesListService, useValue: meLeavesListService },
        { provide: MeOdTeamsService, useValue: meOdTeamsService },
        { provide: MeOdTeamsListService, useValue: meOdTeamsListService },
        { provide: MeOdRequestsService, useValue: meOdRequestsService },
        {
          provide: MeOdRequestsListService,
          useValue: meOdRequestsListService,
        },
        { provide: MeOdAttachmentsService, useValue: meOdAttachmentsService },
        { provide: MeHostelOutingsService, useValue: meHostelOutingsService },
        {
          provide: MeCampusOutingsService,
          useValue: meCampusOutingsService,
        },
        {
          provide: MeBonafideRequestsService,
          useValue: meBonafideRequestsService,
        },
        { provide: MeProjectsService, useValue: meProjectsService },
        {
          provide: MeFacultyDirectoryService,
          useValue: meFacultyDirectoryService,
        },
        { provide: MeFeesService, useValue: meFeesService },
        { provide: MeExamScheduleService, useValue: meExamScheduleService },
        { provide: MeHostelRoomService, useValue: meHostelRoomService },
        {
          provide: MeHostelComplaintsService,
          useValue: meHostelComplaintsService,
        },
        { provide: MeMessFeedbackService, useValue: meMessFeedbackService },
        {
          provide: MeAcademicCalendarService,
          useValue: meAcademicCalendarService,
        },
        {
          provide: MeAcademicClearanceService,
          useValue: meAcademicClearanceService,
        },
      ],
    }).compile();

    controller = module.get<MeController>(MeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('restricts updateProfile() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const roles = reflector.get<string[]>(ROLES_KEY, controller.updateProfile);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates to MeProfileService, never trusting a client-supplied id', () => {
    const dto = { student_mobile: '9876500099' };
    void controller.updateProfile(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meProfileService.updateMyProfile).toHaveBeenCalledWith(7, dto);
  });

  it('restricts getProfile() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const roles = reflector.get<string[]>(ROLES_KEY, controller.getProfile);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates getProfile() to MeProfileService', () => {
    void controller.getProfile({
      sub: 7,
      email: 'a@b.com',
      role: 'student',
      roleId: 4,
    });

    expect(meProfileService.getMyProfile).toHaveBeenCalledWith(7);
  });

  it('restricts getAttendance() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const roles = reflector.get<string[]>(ROLES_KEY, controller.getAttendance);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates getAttendance() to MeAttendanceService', () => {
    const dto = { from: '2026-07-01', to: '2026-07-31' };
    void controller.getAttendance(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meAttendanceService.getMyAttendance).toHaveBeenCalledWith(7, dto);
  });

  it('restricts createLeave() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const roles = reflector.get<string[]>(ROLES_KEY, controller.createLeave);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates createLeave() to MeLeavesService', () => {
    const dto = {
      from_date: '2099-08-01',
      to_date: '2099-08-03',
      reason: 'Family function',
    };
    void controller.createLeave(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meLeavesService.createLeave).toHaveBeenCalledWith(7, dto);
  });

  it('restricts getLeaves() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const roles = reflector.get<string[]>(ROLES_KEY, controller.getLeaves);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates getLeaves() to MeLeavesListService', () => {
    const dto = { status: student_leave_status_enum.pending };
    void controller.getLeaves(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meLeavesListService.getMyLeaves).toHaveBeenCalledWith(7, dto);
  });

  it('restricts createOdTeam() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const roles = reflector.get<string[]>(ROLES_KEY, controller.createOdTeam);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates createOdTeam() to MeOdTeamsService with the request body', () => {
    const dto = {
      team_name: 'Team Nexus',
      reason: 'IEEE paper presentation',
      venue: 'Anna University, Chennai',
      from_date: '2999-01-10',
      to_date: '2999-01-12',
      from_time: '09:00',
      to_time: '17:00',
      faculty_guide_id: 41,
    };
    void controller.createOdTeam(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meOdTeamsService.createOdTeam).toHaveBeenCalledWith(7, dto);
  });

  it('restricts joinOdTeam() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const roles = reflector.get<string[]>(ROLES_KEY, controller.joinOdTeam);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates joinOdTeam() to MeOdTeamsService', () => {
    const dto = { unique_code: 'X7K9QT' };
    void controller.joinOdTeam(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meOdTeamsService.joinOdTeam).toHaveBeenCalledWith(7, dto);
  });

  it('restricts removeOdTeamMember() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.removeOdTeamMember;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates removeOdTeamMember() to MeOdTeamsService with the path params', () => {
    void controller.removeOdTeamMember(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      61,
      8,
    );

    expect(meOdTeamsService.removeOdTeamMember).toHaveBeenCalledWith(7, 61, 8);
  });

  it('restricts submitOdRequest() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.submitOdRequest;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates submitOdRequest() to MeOdTeamsService with the team id', () => {
    const dto = {
      from_date: '2099-08-12',
      to_date: '2099-08-13',
      reason: 'Inter-college hackathon',
    };
    void controller.submitOdRequest(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      61,
      dto,
    );

    expect(meOdTeamsService.submitOdRequest).toHaveBeenCalledWith(7, 61, dto);
  });

  it('restricts getOdRequest() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.getOdRequest;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates getOdRequest() to MeOdRequestsService with the id', () => {
    void controller.getOdRequest(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      61,
    );

    expect(meOdRequestsService.getOdRequestStatus).toHaveBeenCalledWith(7, 61);
  });

  it('restricts createHostelOuting() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.createHostelOuting;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates createHostelOuting() to MeHostelOutingsService', () => {
    const dto = {
      from_date: '2099-08-02',
      to_date: '2099-08-02',
      start_time: '09:00',
      return_time: '18:00',
      reason: 'Family visit',
    };
    void controller.createHostelOuting(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meHostelOutingsService.createHostelOuting).toHaveBeenCalledWith(
      7,
      dto,
    );
  });

  it('restricts getHostelOutings() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.getHostelOutings;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates getHostelOutings() to MeHostelOutingsService', () => {
    const dto = { status: 'pending' as const };
    void controller.getHostelOutings(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meHostelOutingsService.getMyHostelOutings).toHaveBeenCalledWith(
      7,
      dto,
    );
  });

  it('restricts createBonafideRequest() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.createBonafideRequest;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates createBonafideRequest() to MeBonafideRequestsService', () => {
    const dto = { reason_id: 3 };
    void controller.createBonafideRequest(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(
      meBonafideRequestsService.createBonafideRequest,
    ).toHaveBeenCalledWith(7, dto);
  });

  it('restricts getBonafideRequests() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.getBonafideRequests;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates getBonafideRequests() to MeBonafideRequestsService', () => {
    const dto = { status: 'pending' as const };
    void controller.getBonafideRequests(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(
      meBonafideRequestsService.getMyBonafideRequests,
    ).toHaveBeenCalledWith(7, dto);
  });

  it('restricts createProject() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.createProject;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates createProject() to MeProjectsService', () => {
    const dto = { title: 'Real-Time OD Attendance Tracker' };
    void controller.createProject(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meProjectsService.createProject).toHaveBeenCalledWith(7, dto);
  });

  it('restricts getProjects() to the student role', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never invoking it detached from `controller`
    const target = controller.getProjects;
    const roles = reflector.get<string[]>(ROLES_KEY, target);
    expect(roles).toEqual([ROLES.STUDENT]);
  });

  it('resolves student_id from the JWT and delegates getProjects() to MeProjectsService', () => {
    const dto = { page: 1, page_size: 20 };
    void controller.getProjects(
      { sub: 7, email: 'a@b.com', role: 'student', roleId: 4 },
      dto,
    );

    expect(meProjectsService.getMyProjects).toHaveBeenCalledWith(7, dto);
  });
});
