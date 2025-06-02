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
  UsePipes,
  ValidationPipe,
  UseGuards,
  Res,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { ApiResponse } from 'src/comman/api-response';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from 'src/comman/auth/jwt-auth.guard';
import { Response } from 'express';

@Controller('users')
@UsePipes(new ValidationPipe({ transform: true }))
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    try {
      const result = await this.userService.login(loginDto);
      return ApiResponse.success(result, 'Login successful', HttpStatus.OK);
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Login failed',
        error.message,
        error.status || HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    try {
      const user = await this.userService.create(createUserDto);
      return ApiResponse.success(
        user,
        'User created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to create user',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Query() query: UserQueryDto) {
    try {
      const result = await this.userService.findAll(query);
      return ApiResponse.success(result, 'Users retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to retrieve users',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('export')
  async exportDevices(
    @Query('format') format: 'pdf' | 'xlsx' | 'csv',
    @Res() res: Response,
  ): Promise<any> {
    try {
      const devices = await this.userService.findAllWithoutPagination();

      switch (format) {
        case 'csv':
          return this.userService.exportToCSV(devices, res);
        case 'xlsx':
          return this.userService.exportToXLSX(devices, res);
        case 'pdf':
          return this.userService.exportToPDF(devices, res);
        default:
          return res
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: 'Invalid format' });
      }
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to export devices',
        error: error.message,
      });
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const user = await this.userService.findOne(id);
      return ApiResponse.success(user, 'User retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to retrieve user',
        error.message,
        error.status || HttpStatus.NOT_FOUND,
      );
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    try {
      const user = await this.userService.update(id, updateUserDto);
      return ApiResponse.success(user, 'User updated successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to update user',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.userService.remove(id);
      return ApiResponse.success(null, 'User deleted successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to delete user',
        error.message,
        error.status || HttpStatus.NOT_FOUND,
      );
    }
  }

  @Patch(':id/password')
  async updatePassword(
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    try {
      await this.userService.updatePassword(id, password);
      return ApiResponse.success(null, 'Password updated successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to update password',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }
}
