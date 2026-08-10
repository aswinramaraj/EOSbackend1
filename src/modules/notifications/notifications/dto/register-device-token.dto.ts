import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /notifications/register-device */
export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  push_token: string;

  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';
}
