/** Port: thông báo cho người dùng. Thật = toast Windows; fake = ghi lại để e2e assert. */
export interface Toast {
  readonly title: string;
  readonly body: string;
  readonly openUrl: string;
}

export interface Notifier {
  notify(toast: Toast): Promise<void>;
}
