import type { Clock } from "../shared/ports/clock.port.ts";
import type { GitHubGateway, GitHubIssueSnapshot } from "../shared/ports/github-gateway.port.ts";
import type { Notifier, Toast } from "../shared/ports/notifier.port.ts";

export class FakeGitHub implements GitHubGateway {
  issues: GitHubIssueSnapshot[] = [];
  async fetchUpdatedIssues(_project: unknown, since: Date) {
    return this.issues.filter((i) => new Date(i.updatedAt) > since);
  }
}

export class RecordingNotifier implements Notifier {
  readonly sent: Toast[] = [];
  async notify(toast: Toast) {
    this.sent.push(toast);
  }
}

export class ControllableClock implements Clock {
  static readonly INITIAL = "2026-01-01T00:00:00Z";
  private current = new Date(ControllableClock.INITIAL);
  now() {
    return new Date(this.current);
  }
  set(iso: string) {
    this.current = new Date(iso);
  }
  reset() {
    this.current = new Date(ControllableClock.INITIAL);
  }
}
