export class GraphQLEndpoint {
  constructor(readonly url: string) {}
}

export class GraphQLProcessingMilestone {
  constructor(readonly argumentName: string = 'asOf') {}
}

export class GraphQLBusinessDateMilestone {
  constructor(readonly argumentName: string = 'businessDate') {}
}

export class GraphQLBiTemporalMilestone {
  constructor(
    readonly businessDateArgument: string = 'businessDate',
    readonly processingArgument: string = 'asOf',
  ) {}
}

export type GraphQLMilestone =
  | GraphQLProcessingMilestone
  | GraphQLBusinessDateMilestone
  | GraphQLBiTemporalMilestone;

export class GraphQLQuery {
  constructor(
    readonly name: string,
    readonly endpoint: GraphQLEndpoint,
    readonly milestone?: GraphQLMilestone,
  ) {}
}

export class GraphQLField {
  constructor(readonly name: string) {}
}
