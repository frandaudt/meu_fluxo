import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MenuLateral } from '../menu-lateral/menu-lateral';


@Component({
  selector: 'app-cabecalho',
  imports: [RouterOutlet, MenuLateral],
  templateUrl: './cabecalho.html',
  styleUrl: './cabecalho.css',
})
export class Cabecalho {}
