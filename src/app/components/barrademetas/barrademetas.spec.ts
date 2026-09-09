import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Barrademetas } from './barrademetas';

describe('Barrademetas', () => {
  let component: Barrademetas;
  let fixture: ComponentFixture<Barrademetas>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Barrademetas],
    }).compileComponents();

    fixture = TestBed.createComponent(Barrademetas);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
