import { ModuleStub } from "@/components/ModuleStub";

export default function HrPage() {
  return (
    <ModuleStub
      title="Human Resources"
      spec="Build-Spec §4.10"
      summary="Personal data throughout — every screen sits behind a dedicated hr permission scope. Leave, recruitment, candidate records (no external sourcing — Schedule A3(8)), employee records."
      screens={["Leave", "Recruitment", "Candidate records", "Employee records"]}
    />
  );
}
