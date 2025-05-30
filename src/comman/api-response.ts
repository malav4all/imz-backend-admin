import { HttpStatus } from '@nestjs/common';

export class ApiResponse<T = any> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T | null;
  errors?: string;

  constructor(
    success: boolean,
    statusCode: number,
    message: string,
    data?: T | null,
    errors?: string,
  ) {
    this.success = success;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data || null;
    this.errors = errors;
  }

  static success<T>(
    data: T,
    message: string = 'Operation successful',
    statusCode: number = HttpStatus.OK,
  ): ApiResponse<T> {
    return new ApiResponse<T>(true, statusCode, message, data);
  }

  static error<T = any>(
    message: string,
    errors?: string,
    statusCode: number = HttpStatus.BAD_REQUEST,
  ): ApiResponse<T> {
    return new ApiResponse<T>(false, statusCode, message, null, errors);
  }
}
