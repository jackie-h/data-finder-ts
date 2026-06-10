import { EmployeeFinder } from './EmployeeFinder';
import type { EmployeeFinderBase } from './EmployeeFinderBase';


export class SelfRefContext {
  private readonly _employee: EmployeeFinderBase;

  constructor() {
    this._employee = new EmployeeFinder();
  }

  get employee(): EmployeeFinderBase {
    return this._employee;
  }

}