export interface ObservedResult<T> {
  readonly value: T | null;
  readonly error: Error | null;
  readonly isFetching: boolean;
}

export interface ResultObservation<T> {
  /** Closing stops updates and leaves the last observed result readable. */
  read(): ObservedResult<T>;
  close(): void;
}

export interface ObservedPaginatedResult<T> extends ObservedResult<T> {
  readonly hasMore: boolean;
  readonly isFetchingNextPage: boolean;
}

export type ObservedPaginatedResultListener<T> = (result: ObservedPaginatedResult<T>) => void;
