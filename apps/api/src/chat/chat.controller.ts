import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { ChatService } from './chat.service';
import type { ChatRequestDto } from '@soc/shared';

@Controller('chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async chat(@Body() body: ChatRequestDto) {
    const result = await this.chatService.chat(body);
    return { data: result };
  }
}
