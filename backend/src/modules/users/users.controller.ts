import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth('jwt')
@Controller('me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Profile, plan and user summary' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const fullName = (user.payload?.user_metadata as { full_name?: string } | undefined)?.full_name;
    return this.usersService.getMe({
      id: user.id,
      email: user.email,
      displayName: fullName,
    });
  }
}
