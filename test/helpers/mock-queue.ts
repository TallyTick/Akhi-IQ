export class MockQueue {
  public jobs: Array<{ name: string; data: any; opts?: any; id: string }> = [];

  async add(name: string, data: any, opts?: any) {
    const id = opts?.jobId || `job_${this.jobs.length + 1}`;
    this.jobs.push({ name, data, opts, id });
    return { id };
  }

  clear() {
    this.jobs = [];
  }
}
