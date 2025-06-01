import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { ApiResponse } from 'src/comman/api-response';

@Controller('accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  async create(@Body() createAccountDto: CreateAccountDto) {
    try {
      const account = await this.accountService.create(createAccountDto);
      return ApiResponse.success(
        account,
        'Account created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        return ApiResponse.error(
          error.message,
          error.message,
          error.getStatus(),
        );
      }
      return ApiResponse.error(
        'Failed to create account',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  async findAll(@Query('clientId') clientId: string) {
    try {
      if (!clientId) {
        return ApiResponse.error(
          'Client ID is required',
          'Missing clientId parameter',
          HttpStatus.BAD_REQUEST,
        );
      }

      const accounts = await this.accountService.findAll(clientId);
      return ApiResponse.success(accounts, 'Accounts retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        'Failed to retrieve accounts',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('stats')
  async getStats(@Query('clientId') clientId: string) {
    try {
      if (!clientId) {
        return ApiResponse.error(
          'Client ID is required',
          'Missing clientId parameter',
          HttpStatus.BAD_REQUEST,
        );
      }

      const stats = await this.accountService.getAccountStats(clientId);
      return ApiResponse.success(
        stats,
        'Account statistics retrieved successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        'Failed to retrieve account statistics',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/stats')
  async getBranchStats(@Param('id') id: string) {
    try {
      const stats = await this.accountService.getBranchStats(id);
      return ApiResponse.success(
        stats,
        'Branch statistics retrieved successfully',
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.NOT_FOUND,
        );
      }
      return ApiResponse.error(
        'Failed to retrieve branch statistics',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('level/:level')
  async findByLevel(
    @Param('level') level: string,
    @Query('clientId') clientId: string,
  ) {
    try {
      if (!clientId) {
        return ApiResponse.error(
          'Client ID is required',
          'Missing clientId parameter',
          HttpStatus.BAD_REQUEST,
        );
      }

      const levelNumber = parseInt(level);
      if (isNaN(levelNumber)) {
        return ApiResponse.error(
          'Invalid level parameter',
          'Level must be a valid number',
          HttpStatus.BAD_REQUEST,
        );
      }

      const accounts = await this.accountService.findByLevel(
        levelNumber,
        clientId,
      );
      return ApiResponse.success(
        accounts,
        `Accounts at level ${levelNumber} retrieved successfully`,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.BAD_REQUEST,
        );
      }
      return ApiResponse.error(
        'Failed to retrieve accounts by level',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const account = await this.accountService.findOne(id);
      return ApiResponse.success(account, 'Account retrieved successfully');
    } catch (error) {
      if (error instanceof NotFoundException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.NOT_FOUND,
        );
      }
      return ApiResponse.error(
        'Failed to retrieve account',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/hierarchy')
  async getHierarchy(@Param('id') id: string) {
    try {
      const hierarchy = await this.accountService.findAccountHierarchy(id);
      return ApiResponse.success(
        hierarchy,
        'Account hierarchy retrieved successfully',
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.NOT_FOUND,
        );
      }
      return ApiResponse.error(
        'Failed to retrieve account hierarchy',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/hierarchy-optimized')
  async getHierarchyOptimized(@Param('id') id: string) {
    try {
      const hierarchy =
        await this.accountService.findAccountHierarchyOptimized(id);
      return ApiResponse.success(
        hierarchy,
        'Optimized account hierarchy retrieved successfully',
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.NOT_FOUND,
        );
      }
      return ApiResponse.error(
        'Failed to retrieve optimized account hierarchy',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/descendants')
  async getDescendants(@Param('id') id: string) {
    try {
      const descendants = await this.accountService.findDescendants(id);
      return ApiResponse.success(
        descendants,
        'Account descendants retrieved successfully',
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.NOT_FOUND,
        );
      }
      return ApiResponse.error(
        'Failed to retrieve account descendants',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateAccountDto: any) {
    try {
      const updatedAccount = await this.accountService.update(
        id,
        updateAccountDto,
      );
      return ApiResponse.success(
        updatedAccount,
        'Account updated successfully',
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.NOT_FOUND,
        );
      }
      return ApiResponse.error(
        'Failed to update account',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.accountService.remove(id);
      return ApiResponse.success(null, 'Account deleted successfully');
    } catch (error) {
      if (error instanceof NotFoundException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.NOT_FOUND,
        );
      }
      if (error instanceof BadRequestException) {
        return ApiResponse.error(
          error.message,
          error.message,
          HttpStatus.BAD_REQUEST,
        );
      }
      return ApiResponse.error(
        'Failed to delete account',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
