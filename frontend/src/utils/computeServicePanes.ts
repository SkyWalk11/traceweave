import type { Project, ServiceBindings, ServicePaneData, Trace } from "../types";

// Pane list is driven by the projects you've registered — not filtered down
// to whatever services happen to appear in the currently active trace. A
// project you added (e.g. CORE) always gets a pane, even before it has any
// steps in this particular trace, so it doesn't just disappear depending on
// which flow you're looking at. Any trace service that isn't covered by a
// project yet still gets a pane too (so you can see and bind it via the
// "unassigned" picker), it's just appended after the registered ones.
//
// A project's default service key is its own name, since the debugger's own
// process orchestration sets TTD_SERVICE_NAME to project.name when it starts
// a project — but serviceBindings can point a differently-named runtime
// service at the same project folder (for source lookup), so that mapping
// takes priority when present.
export function computeServicePanes(
  trace: Trace | null,
  stepIndex: number,
  projects: Project[] = [],
  serviceBindings: ServiceBindings = {}
): ServicePaneData[] {
  const steps = trace?.steps ?? [];

  const latestByService: Record<string, { step: Trace["steps"][number]; index: number }> = {};
  steps.forEach((step, i) => {
    if (i <= stepIndex) latestByService[step.service] = { step, index: i };
  });

  const boundServiceByProject = new Map<string, string>();
  for (const [service, projectId] of Object.entries(serviceBindings)) {
    boundServiceByProject.set(projectId, service);
  }

  const order: string[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    const service = boundServiceByProject.get(project.id) ?? project.name;
    if (seen.has(service)) continue;
    seen.add(service);
    order.push(service);
  }
  for (const step of steps) {
    if (seen.has(step.service)) continue;
    seen.add(step.service);
    order.push(step.service);
  }

  return order.map((service) => ({
    service,
    active: latestByService[service]?.index === stepIndex,
    reached: service in latestByService,
    step: latestByService[service]?.step ?? null,
  }));
}
