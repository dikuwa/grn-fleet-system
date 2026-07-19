--> statement-breakpoint
ALTER TABLE "vehicle_allocations" ADD COLUMN "driver_employee_id" uuid REFERENCES "employees"("id");
