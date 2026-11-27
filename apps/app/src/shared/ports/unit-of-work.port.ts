/**
 * Port: một đơn vị công việc nguyên tử (ADR-0011). `fn` đồng bộ, không `await` bên trong.
 * Ném lỗi trong `fn` thì mọi thay đổi trong đơn vị bị huỷ và lỗi được ném lại nguyên vẹn. Không lồng.
 */
export interface UnitOfWork {
  run<T>(fn: () => T): T;
}
