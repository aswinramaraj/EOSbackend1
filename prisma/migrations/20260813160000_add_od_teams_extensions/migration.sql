-- AlterTable
ALTER TABLE "od_teams" ADD COLUMN     "team_name" VARCHAR(150),
ADD COLUMN     "reason" VARCHAR(255),
ADD COLUMN     "venue" VARCHAR(255),
ADD COLUMN     "from_date" DATE,
ADD COLUMN     "to_date" DATE,
ADD COLUMN     "from_time" TIMETZ(6),
ADD COLUMN     "to_time" TIMETZ(6),
ADD COLUMN     "faculty_guide_id" INTEGER;

-- AddForeignKey
ALTER TABLE "od_teams" ADD CONSTRAINT "od_teams_faculty_guide_id_fkey" FOREIGN KEY ("faculty_guide_id") REFERENCES "faculty"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
