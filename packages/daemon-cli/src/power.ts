import { defaultPowerPolicy, type PowerPolicy } from "@bridge/protocol";
import { spawn, type ChildProcess } from "node:child_process";

export class WakeLockManager {
  private process: ChildProcess | null = null;
  private activeSessions = 0;
  private policy: PowerPolicy = { ...defaultPowerPolicy };

  getPolicy(): PowerPolicy {
    return this.policy;
  }

  updatePolicy(policy: PowerPolicy): PowerPolicy {
    this.policy = policy;
    void this.reconcile();
    return this.policy;
  }

  onSessionStarted(): void {
    this.activeSessions += 1;
    void this.reconcile();
  }

  onSessionStopped(): void {
    this.activeSessions = Math.max(0, this.activeSessions - 1);
    void this.reconcile();
  }

  private async reconcile(): Promise<void> {
    const shouldHold =
      this.policy.mode === "always-awake" ||
      (this.policy.mode === "stay-awake-during-activity" && this.activeSessions > 0);

    if (shouldHold && !this.process && process.platform === "darwin") {
      this.process = spawn("caffeinate", ["-dimsu"], { stdio: "ignore" });
      this.process.on("exit", () => {
        this.process = null;
      });
      return;
    }

    if (!shouldHold && this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }
}
