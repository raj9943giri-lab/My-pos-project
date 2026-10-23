import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

/** Consistent JSON errors: { message, status, error? } — Hindi messages preserved. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = 500;
    let payload: any = { message: 'सर्वर त्रुटि', status: 500 };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      payload = typeof r === 'string' ? { message: r, status } : { status, ...(r as object) };
    } else if (exception && typeof exception === 'object' && 'status' in (exception as any)) {
      const e: any = exception;
      status = e.status || 500;
      // extras (suggestions, reason, currentStatus, retryAfter, lines…) दुकान/ऐप को चाहिए
      const { message: _m, status: _s, stack: _stack, ...extras } = e;
      payload = { message: e.message, status, ...extras };
    } else if (exception instanceof Error) {
      payload = { message: exception.message, status: 500 };
    }
    res.status(status).json(payload);
  }
}
