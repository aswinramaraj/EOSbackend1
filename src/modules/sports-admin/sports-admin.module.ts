import { Module } from '@nestjs/common';
import { SportsAdminMeModule } from './me/me.module';
import { SportsDashboardModule } from './dashboard/dashboard.module';
import { SportsSearchModule } from './search/search.module';
import { SportsLookupModule } from './lookup/lookup.module';
import { DisciplinesModule } from './disciplines/disciplines.module';
import { FacilitiesModule } from './facilities/facilities.module';
import { EquipmentModule } from './equipment/equipment.module';
import { CoachesModule } from './coaches/coaches.module';
import { AthletesModule } from './athletes/athletes.module';
import { TeamsModule } from './teams/teams.module';
import { TrialsModule } from './trials/trials.module';
import { SessionsModule } from './sessions/sessions.module';
import { AchievementsModule as SportsAchievementsModule } from './achievements/achievements.module';
import { FitnessModule } from './fitness/fitness.module';
import { InjuriesModule } from './injuries/injuries.module';
import { FixturesModule } from './fixtures/fixtures.module';
import { CalendarModule as SportsCalendarModule } from './calendar/calendar.module';
import { AnnouncementsModule as SportsAnnouncementsModule } from './announcements/announcements.module';
import { BudgetModule } from './budget/budget.module';
import { OdModule as SportsOdModule } from './od/od.module';
import { ReportsModule as SportsReportsModule } from './reports/reports.module';

/**
 * Single entry point for the whole Sports Admin module — app.module.ts only
 * ever imports THIS, so none of the sub-resource module class names above
 * (several of which collide with unrelated modules elsewhere, e.g. the
 * student `od`/`announcements`/`achievements`/hostel `reports` modules) leak
 * into the app-level import namespace. Aliased on import instead of renaming
 * the sub-resource files themselves, since those were built independently
 * against a fixed spec.
 */
@Module({
  imports: [
    SportsAdminMeModule,
    SportsDashboardModule,
    SportsSearchModule,
    SportsLookupModule,
    DisciplinesModule,
    FacilitiesModule,
    EquipmentModule,
    CoachesModule,
    AthletesModule,
    TeamsModule,
    TrialsModule,
    SessionsModule,
    SportsAchievementsModule,
    FitnessModule,
    InjuriesModule,
    FixturesModule,
    SportsCalendarModule,
    SportsAnnouncementsModule,
    BudgetModule,
    SportsOdModule,
    SportsReportsModule,
  ],
})
export class SportsAdminModule {}
