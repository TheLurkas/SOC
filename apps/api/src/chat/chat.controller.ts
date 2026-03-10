import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import type { ChatRequestDto } from '@soc/shared';

@Controller('chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  async listConversations(@CurrentUser() user: any) {
    const conversations = await this.chatService.listConversations(user.id);
    return { data: conversations };
  }

  @Get('conversations/:id')
  async getConversation(@CurrentUser() user: any, @Param('id') id: string) {
    const conversation = await this.chatService.getConversation(user.id, id);
    return { data: conversation };
  }

  @Delete('conversations/:id')
  async deleteConversation(@CurrentUser() user: any, @Param('id') id: string) {
    await this.chatService.deleteConversation(user.id, id);
    return { data: { id } };
  }

  @Post('message')
  async sendMessage(@CurrentUser() user: any, @Body() body: ChatRequestDto) {
    const result = await this.chatService.sendMessage(user.id, body);
    return { data: result };
  }

  // scoped @mention autocomplete
  @Get('suggestions')
  async getSuggestions(
    @Query('q') query: string,
    @Query('companyId') companyId?: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const suggestions = await this.chatService.getSuggestions(query || '', companyId, workspaceId);
    return { data: suggestions };
  }
}
