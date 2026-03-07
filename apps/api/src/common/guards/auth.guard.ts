import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { auth } from '../../auth/auth';

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const session = await auth.api.getSession({ headers: req.headers as any });

    if (!session?.user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    req.user = session.user;
    return true;
  }
}
